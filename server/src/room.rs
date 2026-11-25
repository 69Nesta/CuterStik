//! One match: owns every player in it, runs the 64 Hz tick loop and the
//! game-mode rules, and broadcasts snapshots.
//!
//! Every mode shares one phase machine:
//! Warmup (free respawns, until enough players) → Freeze → Live →
//! (Elimination only: RoundEnd → Freeze → Live …) → MatchEnd → Freeze …

use std::collections::{BTreeMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use shared::{
    combat::{HitZone, damage_for, trace_shot},
    constants::*,
    map::{DM_SPAWNS, spawn_point, spawn_yaw, yaw_to_center},
    math::{Vec3, view_dir},
    movement::{MoveState, step},
    protocol::{
        self, Buttons, GameEvent, GameMode, InputCmd, MatchWinner, Phase, PlayerId, PlayerInfo,
        PlayerSnap, RoomId, ServerMsg, Snapshot, Team,
    },
};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::{Instant, MissedTickBehavior};

/// Inputs applied per player per tick. Above 1 lets a client catch up after
/// a network hiccup; the cap stops speed hacks by flooding.
const MAX_INPUTS_PER_TICK: usize = 2;
/// Older inputs are dropped past this backlog.
const MAX_INPUT_BACKLOG: usize = 16;
const EMPTY_ROOM_TTL: Duration = Duration::from_secs(30);

/// What the lobby's room list shows about a room.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoomStatus {
    pub players: usize,
    pub phase: &'static str,
    pub round: u16,
    /// Team modes: team scores. Deathmatch: `score_t` is the leader's kills.
    pub score_t: u16,
    pub score_ct: u16,
}

impl Default for RoomStatus {
    fn default() -> Self {
        Self {
            players: 0,
            phase: "Warmup",
            round: 0,
            score_t: 0,
            score_ct: 0,
        }
    }
}

pub enum RoomCmd {
    Join {
        name: String,
        team: Option<Team>,
        out: mpsc::Sender<Bytes>,
        reply: oneshot::Sender<Option<PlayerId>>,
    },
    Input {
        id: PlayerId,
        cmd: InputCmd,
    },
    Leave {
        id: PlayerId,
    },
}

struct Player {
    info: PlayerInfo,
    out: mpsc::Sender<Bytes>,
    mv: MoveState,
    yaw: f32,
    pitch: f32,
    inputs: VecDeque<InputCmd>,
    ack_seq: u32,

    health: u8,
    alive: bool,
    respawn_in: Option<f32>,
    spawn_id: u16,
    /// Seconds of damage immunity left after a respawn.
    protected_for: f32,

    ammo: u8,
    reload_left: f32,
    fire_cooldown: f32,

    kills: u16,
    deaths: u16,
}

impl Player {
    fn spawn_at(&mut self, pos: Vec3, yaw: f32, protection: f32) {
        self.mv = MoveState {
            pos,
            ..Default::default()
        };
        self.yaw = yaw;
        self.pitch = 0.0;
        self.health = MAX_HEALTH;
        self.alive = true;
        self.respawn_in = None;
        self.spawn_id = self.spawn_id.wrapping_add(1);
        self.protected_for = protection;
        self.ammo = MAG_SIZE;
        self.reload_left = 0.0;
        self.fire_cooldown = 0.0;
        // Inputs queued before the respawn were aimed at the old life.
        self.inputs.clear();
    }

    fn eye(&self) -> Vec3 {
        let p = self.mv.pos;
        Vec3::new(p.x, p.y + self.mv.eye_height(), p.z)
    }

    fn snap(&self) -> PlayerSnap {
        PlayerSnap {
            id: self.info.id,
            team: self.info.team,
            pos: self.mv.pos,
            vel: self.mv.vel,
            on_ground: self.mv.on_ground,
            slide: self.mv.slide,
            slide_cooldown: self.mv.slide_cooldown,
            slide_held: self.mv.slide_held,
            yaw: self.yaw,
            pitch: self.pitch,
            health: self.health,
            alive: self.alive,
            ammo: self.ammo,
            reloading: self.reload_left > 0.0,
            kills: self.kills,
            deaths: self.deaths,
            spawn_id: self.spawn_id,
        }
    }
}

struct PendingShot {
    shooter: PlayerId,
    team: Team,
    origin: Vec3,
    dir: Vec3,
}

pub struct Room {
    id: RoomId,
    name: Arc<str>,
    mode: GameMode,
    status: watch::Sender<RoomStatus>,
    players: BTreeMap<PlayerId, Player>,
    next_player_id: PlayerId,
    tick: u32,

    phase: Phase,
    phase_left: f32,
    round: u16,
    score_t: u16,
    score_ct: u16,

    events: Vec<GameEvent>,
}

impl Room {
    pub fn new(
        id: RoomId,
        name: Arc<str>,
        mode: GameMode,
        status: watch::Sender<RoomStatus>,
    ) -> Self {
        Self {
            id,
            name,
            mode,
            status,
            players: BTreeMap::new(),
            next_player_id: 1,
            tick: 0,
            phase: Phase::Warmup,
            phase_left: 0.0,
            round: 0,
            score_t: 0,
            score_ct: 0,
            events: Vec::new(),
        }
    }

    pub async fn run(mut self, mut rx: mpsc::Receiver<RoomCmd>) {
        let mut interval = tokio::time::interval(Duration::from_secs_f64(1.0 / TICK_RATE as f64));
        interval.set_missed_tick_behavior(MissedTickBehavior::Burst);
        let mut empty_since = Some(Instant::now());

        loop {
            tokio::select! {
                cmd = rx.recv() => {
                    let Some(cmd) = cmd else { break };
                    self.handle(cmd);
                    empty_since = match (self.players.is_empty(), empty_since) {
                        (true, None) => Some(Instant::now()),
                        (true, since) => since,
                        (false, _) => None,
                    };
                }
                _ = interval.tick() => {
                    if let Some(since) = empty_since {
                        if since.elapsed() > EMPTY_ROOM_TTL {
                            break;
                        }
                        continue;
                    }
                    self.update();
                }
            }
        }
        tracing::info!(room = self.id, "room closed");
    }

    fn handle(&mut self, cmd: RoomCmd) {
        match cmd {
            RoomCmd::Join {
                name,
                team,
                out,
                reply,
            } => {
                let id = self.add_player(name, team, out);
                let _ = reply.send(id);
            }
            RoomCmd::Input { id, cmd } => {
                if let Some(p) = self.players.get_mut(&id) {
                    if p.inputs.len() >= MAX_INPUT_BACKLOG {
                        p.inputs.pop_front();
                    }
                    p.inputs.push_back(cmd);
                }
            }
            RoomCmd::Leave { id } => {
                if let Some(p) = self.players.remove(&id) {
                    tracing::info!(room = self.id, player = id, name = %p.info.name, "left");
                    self.events.push(GameEvent::Left { id });
                    self.publish_status();
                }
            }
        }
    }

    fn add_player(
        &mut self,
        name: String,
        preferred: Option<Team>,
        out: mpsc::Sender<Bytes>,
    ) -> Option<PlayerId> {
        if self.players.len() >= MAX_PLAYERS_PER_ROOM {
            return None;
        }
        let id = self.next_player_id;
        self.next_player_id += 1;

        // Honor the preferred side unless it already has more players.
        // Free-for-all ignores sides entirely.
        let preferred = preferred.filter(|_| self.mode.has_teams());
        let team = match preferred {
            Some(t) if self.team_count(t) <= self.team_count(t.other()) => t,
            _ if self.team_count(Team::T) <= self.team_count(Team::Ct) => Team::T,
            _ => Team::Ct,
        };
        let name = if name.is_empty() {
            format!("Player{id}")
        } else {
            name
        };
        let info = PlayerInfo { id, name, team };

        let mut player = Player {
            info: info.clone(),
            out,
            mv: MoveState::default(),
            yaw: 0.0,
            pitch: 0.0,
            inputs: VecDeque::new(),
            ack_seq: 0,
            health: 0,
            alive: false,
            respawn_in: None,
            spawn_id: 0,
            protected_for: 0.0,
            ammo: MAG_SIZE,
            reload_left: 0.0,
            fire_cooldown: 0.0,
            kills: 0,
            deaths: 0,
        };
        // Elimination: mid-round joiners wait for the next round, like in CS.
        // Deathmatch modes: drop straight in unless the match is wrapping up.
        let spawn_now = match self.phase {
            Phase::Warmup | Phase::Freeze => true,
            Phase::Live => self.mode.respawns(),
            Phase::RoundEnd { .. } | Phase::MatchEnd { .. } => false,
        };
        if spawn_now {
            let index = self.team_count(team);
            let (pos, yaw) = self.pick_spawn(team, index);
            player.spawn_at(pos, yaw, self.protection());
        }

        let roster: Vec<PlayerInfo> = self
            .players
            .values()
            .map(|p| p.info.clone())
            .chain(std::iter::once(info.clone()))
            .collect();
        let welcome = protocol::encode(&ServerMsg::Welcome {
            your_id: id,
            room_id: self.id,
            room_name: self.name.to_string(),
            mode: self.mode,
            tick_rate: TICK_RATE,
            roster,
        });
        let _ = player.out.try_send(welcome.into());

        tracing::info!(room = self.id, player = id, name = %info.name, ?team, "joined");
        self.events.push(GameEvent::Joined(info));
        self.players.insert(id, player);
        self.publish_status();
        Some(id)
    }

    fn team_count(&self, team: Team) -> usize {
        self.players.values().filter(|p| p.info.team == team).count()
    }

    fn alive_count(&self, team: Team) -> usize {
        self.players
            .values()
            .filter(|p| p.info.team == team && p.alive)
            .count()
    }

    /// Enough players for a real match.
    fn ready(&self) -> bool {
        if self.mode.has_teams() {
            self.team_count(Team::T) > 0 && self.team_count(Team::Ct) > 0
        } else {
            self.players.len() >= 2
        }
    }

    fn protection(&self) -> f32 {
        if self.mode.respawns() {
            SPAWN_PROTECTION
        } else {
            0.0
        }
    }

    /// Spawn position and facing for a (re)spawning player.
    fn pick_spawn(&self, team: Team, index: usize) -> (Vec3, f32) {
        if self.mode.has_teams() {
            return (spawn_point(team, index), spawn_yaw(team));
        }
        // Free-for-all: the spawn whose nearest living player is farthest.
        let living: Vec<Vec3> = self
            .players
            .values()
            .filter(|p| p.alive)
            .map(|p| p.mv.pos)
            .collect();
        let pos = DM_SPAWNS
            .iter()
            .copied()
            .max_by(|a, b| {
                let near = |s: Vec3| {
                    living
                        .iter()
                        .map(|p| (*p - s).length())
                        .fold(f32::INFINITY, f32::min)
                };
                near(*a).total_cmp(&near(*b))
            })
            .unwrap_or(DM_SPAWNS[index % DM_SPAWNS.len()]);
        (pos, yaw_to_center(pos))
    }

    // --- Tick ------------------------------------------------------------

    fn update(&mut self) {
        let shots = self.apply_inputs();
        for shot in shots {
            self.resolve_shot(shot);
        }
        for p in self.players.values_mut() {
            p.protected_for = (p.protected_for - DT).max(0.0);
        }
        self.update_rules();
        self.publish_status();
        self.broadcast();
        self.tick = self.tick.wrapping_add(1);
    }

    fn apply_inputs(&mut self) -> Vec<PendingShot> {
        let can_act = !matches!(self.phase, Phase::Freeze | Phase::MatchEnd { .. });
        let mut shots = Vec::new();

        for p in self.players.values_mut() {
            for _ in 0..MAX_INPUTS_PER_TICK {
                let Some(cmd) = p.inputs.pop_front() else { break };
                p.ack_seq = cmd.seq;
                p.yaw = cmd.yaw;
                p.pitch = cmd.pitch;
                if !p.alive {
                    continue;
                }

                // Weapon timers advance per input, same as movement, so
                // fire rate can't be beaten by sending inputs faster.
                p.fire_cooldown = (p.fire_cooldown - DT).max(0.0);
                if p.reload_left > 0.0 {
                    p.reload_left -= DT;
                    if p.reload_left <= 0.0 {
                        p.reload_left = 0.0;
                        p.ammo = MAG_SIZE;
                    }
                }
                if cmd.buttons.has(Buttons::RELOAD) && p.reload_left == 0.0 && p.ammo < MAG_SIZE
                {
                    p.reload_left = RELOAD_TIME;
                }
                if can_act
                    && cmd.buttons.has(Buttons::FIRE)
                    && p.fire_cooldown <= 0.0
                    && p.reload_left == 0.0
                    && p.ammo > 0
                {
                    p.ammo -= 1;
                    p.fire_cooldown = FIRE_INTERVAL;
                    p.protected_for = 0.0;
                    shots.push(PendingShot {
                        shooter: p.info.id,
                        team: p.info.team,
                        origin: p.eye(),
                        dir: view_dir(cmd.yaw, cmd.pitch),
                    });
                    if p.ammo == 0 {
                        p.reload_left = RELOAD_TIME;
                    }
                }

                p.mv = step(&p.mv, &cmd, can_act);
            }
        }
        shots
    }

    fn resolve_shot(&mut self, shot: PendingShot) {
        let teams = self.mode.has_teams();
        let targets = self
            .players
            .values()
            .filter(|p| {
                p.alive && p.info.id != shot.shooter && (!teams || p.info.team != shot.team)
            })
            .map(|p| (p.info.id, p.mv.pos));
        let result = trace_shot(shot.origin, shot.dir, targets);

        self.events.push(GameEvent::Shot {
            shooter: shot.shooter,
            from: shot.origin,
            to: result.end,
            hit: result.hit.map(|(id, _)| id),
        });

        let Some((victim_id, zone)) = result.hit else { return };
        let warmup = self.phase == Phase::Warmup;
        let live = self.phase == Phase::Live;
        let respawns = self.mode.respawns();
        let Some(victim) = self.players.get_mut(&victim_id) else { return };
        if victim.protected_for > 0.0 {
            return;
        }

        victim.health = victim.health.saturating_sub(damage_for(zone));
        if victim.health > 0 {
            return;
        }
        victim.alive = false;
        victim.deaths += 1;
        victim.reload_left = 0.0;
        if warmup {
            victim.respawn_in = Some(WARMUP_RESPAWN);
        } else if respawns {
            victim.respawn_in = Some(RESPAWN_TIME);
        }
        if let Some(killer) = self.players.get_mut(&shot.shooter) {
            killer.kills += 1;
        }
        if live && self.mode == GameMode::TeamDeathmatch {
            match shot.team {
                Team::T => self.score_t += 1,
                Team::Ct => self.score_ct += 1,
            }
        }
        self.events.push(GameEvent::Kill {
            killer: shot.shooter,
            victim: victim_id,
            headshot: zone == HitZone::Head,
        });
    }

    fn update_rules(&mut self) {
        match self.phase {
            Phase::Warmup => {
                if self.ready() {
                    self.start_match();
                    return;
                }
                self.respawn_dead();
            }
            Phase::Freeze => {
                self.phase_left -= DT;
                if self.phase_left <= 0.0 {
                    self.phase = Phase::Live;
                    self.phase_left = match self.mode {
                        GameMode::Elimination => ROUND_TIME,
                        GameMode::TeamDeathmatch => TDM_TIME,
                        GameMode::Deathmatch => DM_TIME,
                    };
                }
            }
            Phase::Live => {
                if !self.ready() {
                    self.enter_warmup();
                    return;
                }
                self.phase_left -= DT;
                match self.mode {
                    GameMode::Elimination => self.check_round_over(),
                    GameMode::TeamDeathmatch | GameMode::Deathmatch => {
                        self.respawn_dead();
                        if let Some(winner) = self.match_winner() {
                            self.end_match(winner);
                        }
                    }
                }
            }
            Phase::RoundEnd { .. } => {
                self.phase_left -= DT;
                if self.phase_left <= 0.0 {
                    if self.ready() {
                        self.start_round();
                    } else {
                        self.enter_warmup();
                    }
                }
            }
            Phase::MatchEnd { .. } => {
                self.phase_left -= DT;
                if self.phase_left <= 0.0 {
                    if self.ready() {
                        self.start_match();
                    } else {
                        self.enter_warmup();
                    }
                }
            }
        }
    }

    /// Elimination: a round ends when a side is wiped or the clock runs out.
    fn check_round_over(&mut self) {
        let winner = if self.alive_count(Team::T) == 0 {
            Team::Ct
        } else if self.alive_count(Team::Ct) == 0 {
            Team::T
        } else if self.phase_left <= 0.0 {
            // No objective yet: running out the clock is a CT win.
            Team::Ct
        } else {
            return;
        };
        let score = match winner {
            Team::T => &mut self.score_t,
            Team::Ct => &mut self.score_ct,
        };
        *score += 1;
        if *score >= ROUNDS_TO_WIN {
            self.end_match(MatchWinner::Team(winner));
        } else {
            self.phase = Phase::RoundEnd { winner };
            self.phase_left = ROUND_END_TIME;
        }
    }

    /// Deathmatch modes: kill limit reached, or the clock ran out.
    fn match_winner(&self) -> Option<MatchWinner> {
        let time_up = self.phase_left <= 0.0;
        match self.mode {
            GameMode::Elimination => None,
            GameMode::TeamDeathmatch => {
                let (t, ct) = (self.score_t, self.score_ct);
                if t >= TDM_KILL_LIMIT || ct >= TDM_KILL_LIMIT || time_up {
                    Some(match t.cmp(&ct) {
                        std::cmp::Ordering::Greater => MatchWinner::Team(Team::T),
                        std::cmp::Ordering::Less => MatchWinner::Team(Team::Ct),
                        std::cmp::Ordering::Equal => MatchWinner::Draw,
                    })
                } else {
                    None
                }
            }
            GameMode::Deathmatch => {
                let top = self.players.values().map(|p| p.kills).max().unwrap_or(0);
                if top < DM_KILL_LIMIT && !time_up {
                    return None;
                }
                let mut leaders = self.players.values().filter(|p| p.kills == top);
                Some(match (leaders.next(), leaders.next()) {
                    (Some(p), None) => MatchWinner::Player(p.info.id),
                    _ => MatchWinner::Draw,
                })
            }
        }
    }

    fn end_match(&mut self, winner: MatchWinner) {
        tracing::info!(room = self.id, ?winner, "match over");
        self.phase = Phase::MatchEnd { winner };
        self.phase_left = MATCH_END_TIME;
        for p in self.players.values_mut() {
            p.respawn_in = None;
        }
    }

    fn enter_warmup(&mut self) {
        self.phase = Phase::Warmup;
        self.phase_left = 0.0;
        for p in self.players.values_mut() {
            if !p.alive {
                p.respawn_in = Some(WARMUP_RESPAWN);
            }
        }
    }

    fn start_match(&mut self) {
        self.score_t = 0;
        self.score_ct = 0;
        self.round = 0;
        for p in self.players.values_mut() {
            p.kills = 0;
            p.deaths = 0;
        }
        self.start_round();
    }

    fn start_round(&mut self) {
        self.round += 1;
        self.phase = Phase::Freeze;
        self.phase_left = FREEZE_TIME;
        // Kill everyone first so free-for-all spawn picking spreads players
        // out relative to those already placed, not their old positions.
        for p in self.players.values_mut() {
            p.alive = false;
        }
        let ids: Vec<PlayerId> = self.players.keys().copied().collect();
        let (mut t, mut ct) = (0, 0);
        for id in ids {
            let team = self.players[&id].info.team;
            let index = match team {
                Team::T => &mut t,
                Team::Ct => &mut ct,
            };
            let (pos, yaw) = self.pick_spawn(team, *index);
            *index += 1;
            if let Some(p) = self.players.get_mut(&id) {
                p.spawn_at(pos, yaw, 0.0);
            }
        }
        self.events.push(GameEvent::RoundStart { round: self.round });
    }

    fn respawn_dead(&mut self) {
        let mut due = Vec::new();
        for p in self.players.values_mut() {
            let Some(left) = p.respawn_in.as_mut() else { continue };
            *left -= DT;
            if *left <= 0.0 {
                due.push((p.info.id, p.info.team));
            }
        }
        let protection = self.protection();
        for (i, (id, team)) in due.into_iter().enumerate() {
            let (pos, yaw) = self.pick_spawn(team, self.tick as usize + i);
            if let Some(p) = self.players.get_mut(&id) {
                p.spawn_at(pos, yaw, protection);
            }
        }
    }

    /// Update the lobby-facing status; watchers are only woken on change.
    fn publish_status(&self) {
        let (score_t, score_ct) = match self.mode {
            GameMode::Deathmatch => (
                self.players.values().map(|p| p.kills).max().unwrap_or(0),
                0,
            ),
            _ => (self.score_t, self.score_ct),
        };
        let next = RoomStatus {
            players: self.players.len(),
            phase: match self.phase {
                _ if self.players.is_empty() => "Warmup",
                Phase::Warmup => "Warmup",
                _ => "Live",
            },
            round: self.round,
            score_t,
            score_ct,
        };
        self.status.send_if_modified(|s| {
            let changed = *s != next;
            *s = next;
            changed
        });
    }

    fn broadcast(&mut self) {
        let mut snapshot = Snapshot {
            tick: self.tick,
            ack_seq: 0,
            phase: self.phase,
            phase_time_left: self.phase_left.max(0.0),
            round: self.round,
            score_t: self.score_t,
            score_ct: self.score_ct,
            players: self.players.values().map(Player::snap).collect(),
            events: std::mem::take(&mut self.events),
        };
        for p in self.players.values() {
            snapshot.ack_seq = p.ack_seq;
            let frame = protocol::encode(&ServerMsg::Snapshot(snapshot.clone()));
            // A full buffer means the client is too slow: drop this snapshot,
            // the next one carries the full state anyway. Events are lost in
            // that case, which only affects cosmetics (killfeed, tracers).
            let _ = p.out.try_send(frame.into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn room(mode: GameMode) -> Room {
        let (status, _) = watch::channel(RoomStatus::default());
        Room::new(1, "test".into(), mode, status)
    }

    fn join(room: &mut Room, name: &str) -> PlayerId {
        // Keep the receiver alive by leaking it: tests don't read frames.
        let (tx, rx) = mpsc::channel(4096);
        std::mem::forget(rx);
        room.add_player(name.into(), None, tx).unwrap()
    }

    fn ticks(room: &mut Room, n: usize) {
        for _ in 0..n {
            room.update();
        }
    }

    fn until_live(room: &mut Room) {
        for _ in 0..1000 {
            if room.phase == Phase::Live {
                return;
            }
            room.update();
        }
        panic!("never went live: {:?}", room.phase);
    }

    /// Put `shooter` 6 m behind `target` in the open west lane and fire one
    /// shot at head height.
    fn headshot(room: &mut Room, shooter: PlayerId, target: PlayerId) {
        for (id, z) in [(shooter, 28.0), (target, 22.0)] {
            let p = room.players.get_mut(&id).unwrap();
            p.mv = MoveState {
                pos: Vec3::new(-25.0, 0.0, z),
                on_ground: true,
                ..Default::default()
            };
        }
        let p = room.players.get_mut(&shooter).unwrap();
        p.fire_cooldown = 0.0;
        p.inputs.push_back(InputCmd {
            seq: p.ack_seq + 1,
            buttons: Buttons(Buttons::FIRE),
            ..Default::default()
        });
        room.update();
    }

    #[test]
    fn deathmatch_everyone_is_a_target_and_respawns() {
        let mut r = room(GameMode::Deathmatch);
        let a = join(&mut r, "a");
        let b = join(&mut r, "b");
        until_live(&mut r);
        // Same "team" doesn't matter in free-for-all.
        r.players.get_mut(&b).unwrap().info.team = r.players[&a].info.team;

        headshot(&mut r, a, b);
        assert!(!r.players[&b].alive, "b should be dead");
        assert_eq!(r.players[&a].kills, 1);

        let spawn_before = r.players[&b].spawn_id;
        ticks(&mut r, (RESPAWN_TIME / DT) as usize + 2);
        let b_state = &r.players[&b];
        assert!(b_state.alive && b_state.spawn_id != spawn_before, "b respawned");
        assert!(b_state.protected_for > 0.0, "fresh spawn is protected");

        // Protected: a headshot right after respawn does nothing.
        headshot(&mut r, a, b);
        assert!(r.players[&b].alive);
        assert_eq!(r.players[&b].health, MAX_HEALTH);
    }

    #[test]
    fn deathmatch_kill_limit_ends_match() {
        let mut r = room(GameMode::Deathmatch);
        let a = join(&mut r, "a");
        let b = join(&mut r, "b");
        until_live(&mut r);
        r.players.get_mut(&a).unwrap().kills = DM_KILL_LIMIT - 1;
        headshot(&mut r, a, b);
        assert_eq!(
            r.phase,
            Phase::MatchEnd {
                winner: MatchWinner::Player(a)
            }
        );
        // Next match starts with a clean slate.
        ticks(&mut r, (MATCH_END_TIME / DT) as usize + 2);
        assert_eq!(r.phase, Phase::Freeze);
        assert_eq!(r.players[&a].kills, 0);
    }

    #[test]
    fn team_deathmatch_scores_kills_and_blocks_friendly_fire() {
        let mut r = room(GameMode::TeamDeathmatch);
        let a = join(&mut r, "a");
        let b = join(&mut r, "b");
        let c = join(&mut r, "c");
        until_live(&mut r);
        assert_eq!(r.players[&a].info.team, r.players[&c].info.team);

        headshot(&mut r, a, c);
        assert!(r.players[&c].alive, "no friendly fire in team modes");

        headshot(&mut r, a, b);
        assert!(!r.players[&b].alive);
        let team = r.players[&a].info.team;
        let score = if team == Team::T { r.score_t } else { r.score_ct };
        assert_eq!(score, 1);
        ticks(&mut r, (RESPAWN_TIME / DT) as usize + 2);
        assert!(r.players[&b].alive, "team deathmatch respawns");
    }

    #[test]
    fn elimination_match_ends_at_round_limit() {
        let mut r = room(GameMode::Elimination);
        let a = join(&mut r, "a");
        let b = join(&mut r, "b");
        until_live(&mut r);
        let team = r.players[&a].info.team;
        match team {
            Team::T => r.score_t = ROUNDS_TO_WIN - 1,
            Team::Ct => r.score_ct = ROUNDS_TO_WIN - 1,
        }
        headshot(&mut r, a, b);
        assert_eq!(
            r.phase,
            Phase::MatchEnd {
                winner: MatchWinner::Team(team)
            }
        );
        // No respawns in elimination, even after the wait.
        ticks(&mut r, (RESPAWN_TIME / DT) as usize + 2);
        assert!(!r.players[&b].alive);
    }
}
