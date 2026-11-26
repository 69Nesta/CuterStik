//! One match: owns every player in it, runs the 64 Hz tick loop and the
//! game-mode rules, and broadcasts snapshots.
//!
//! Every mode shares one phase machine:
//! Warmup (free respawns, until enough players) → Freeze → Live →
//! (Elimination only: RoundEnd → Freeze → Live …) → MatchEnd → Freeze …
//!
//! Elimination adds the bomb objective and the round economy; the
//! respawn modes hand out a free loadout instead.

use std::collections::{BTreeMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use shared::{
    combat::{
        HitZone, Target, apply_damage, shot_direction, shot_random, trace_shot, weapon_damage,
    },
    constants::*,
    map::{DM_SPAWNS, in_buy_zone, site_at, spawn_point, spawn_yaw, yaw_to_center},
    math::Vec3,
    movement::{MoveState, step},
    protocol::{
        self, BombState, Buttons, BuyItem, GameEvent, GameMode, InputCmd, MatchWinner, Phase,
        PlayerId, PlayerInfo, PlayerSnap, RoomId, RoundEndReason, ServerMsg, Snapshot, Team,
        VIEW_TIME_SCALE,
    },
    weapons::{Arsenal, Slot, WeaponId, inaccuracy},
};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::{Instant, MissedTickBehavior};

/// Inputs applied per player per tick. Above 1 lets a client catch up after
/// a network hiccup; the cap stops speed hacks by flooding.
const MAX_INPUTS_PER_TICK: usize = 2;
/// Older inputs are dropped past this backlog.
const MAX_INPUT_BACKLOG: usize = 16;
const EMPTY_ROOM_TTL: Duration = Duration::from_secs(30);
/// Ticks of hitbox history kept for lag compensation.
const HISTORY_TICKS: usize = (MAX_REWIND * TICK_RATE as f32) as usize + 4;
/// Respawn modes and warmup: what everyone carries.
const DEFAULT_PRIMARY: WeaponId = WeaponId::Rifle;

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
    Buy {
        id: PlayerId,
        item: BuyItem,
    },
    Leave {
        id: PlayerId,
    },
}

struct Player {
    info: PlayerInfo,
    out: mpsc::Sender<Bytes>,
    mv: MoveState,
    arsenal: Arsenal,
    yaw: f32,
    pitch: f32,
    inputs: VecDeque<InputCmd>,
    ack_seq: u32,
    /// Buttons of the last applied input (plant / defuse are held).
    buttons: Buttons,

    health: u8,
    armor: u8,
    helmet: bool,
    alive: bool,
    respawn_in: Option<f32>,
    spawn_id: u16,
    /// Seconds of damage immunity left after a respawn.
    protected_for: f32,

    money: u16,
    /// Respawn modes: the weapons picked in the buy menu, kept across lives.
    loadout: (Option<WeaponId>, WeaponId),

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
        self.arsenal.refill();
        // Inputs queued before the respawn were aimed at the old life.
        self.inputs.clear();
    }

    /// Free loadout with full armor (respawn modes, warmup).
    fn give_loadout(&mut self) {
        let (primary, secondary) = self.loadout;
        let mut a = Arsenal::new();
        a.secondary = shared::weapons::Gun::full(secondary);
        if let Some(p) = primary {
            a.primary = Some(shared::weapons::Gun::full(p));
            a.active = Slot::Primary;
        }
        self.arsenal = a;
        self.armor = MAX_ARMOR;
        self.helmet = true;
    }

    /// Back to the default pistol, no armor (Elimination after a death).
    fn strip(&mut self) {
        self.arsenal = Arsenal::new();
        self.armor = 0;
        self.helmet = false;
    }

    fn eye(&self) -> Vec3 {
        let p = self.mv.pos;
        Vec3::new(p.x, p.y + self.mv.eye_height(), p.z)
    }

    fn earn(&mut self, amount: u16) {
        self.money = self.money.saturating_add(amount).min(MAX_MONEY);
    }

    /// Standing still enough to plant or defuse, holding the use key.
    fn working_objective(&self) -> bool {
        self.alive
            && self.buttons.has(Buttons::USE)
            && self.mv.on_ground
            && self.mv.horizontal_speed() <= OBJECTIVE_MAX_SPEED
    }

    fn snap(&self) -> PlayerSnap {
        PlayerSnap {
            id: self.info.id,
            team: self.info.team,
            mv: self.mv,
            yaw: self.yaw,
            pitch: self.pitch,
            health: self.health,
            armor: self.armor,
            helmet: self.helmet,
            alive: self.alive,
            weapon: self.arsenal.weapon(),
            reloading: self.arsenal.reloading(),
            zoomed: self.arsenal.zoomed,
            money: self.money,
            kills: self.kills,
            deaths: self.deaths,
            spawn_id: self.spawn_id,
        }
    }
}

struct PendingShot {
    shooter: PlayerId,
    team: Team,
    weapon: WeaponId,
    origin: Vec3,
    dir: Vec3,
    /// Server tick (fractional) the shooter was seeing.
    view_tick: f32,
}

/// Hitboxes of every player at one tick, for lag compensation.
struct Frame {
    tick: u32,
    players: Vec<(PlayerId, Vec3, f32)>,
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
    /// Seconds since the round went live (buy time).
    live_elapsed: f32,
    round: u16,
    score_t: u16,
    score_ct: u16,
    /// Consecutive lost rounds per team, for the loss bonus.
    loss_streak_t: u16,
    loss_streak_ct: u16,

    bomb: BombState,
    planted_this_round: bool,

    history: VecDeque<Frame>,
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
            live_elapsed: 0.0,
            round: 0,
            score_t: 0,
            score_ct: 0,
            loss_streak_t: 0,
            loss_streak_ct: 0,
            bomb: BombState::Inactive,
            planted_this_round: false,
            history: VecDeque::new(),
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
            RoomCmd::Buy { id, item } => self.buy(id, item),
            RoomCmd::Leave { id } => {
                if let Some(p) = self.players.remove(&id) {
                    tracing::info!(room = self.id, player = id, name = %p.info.name, "left");
                    if matches!(self.bomb, BombState::Carried { by, .. } if by == id) {
                        self.drop_bomb(p.mv.pos);
                    }
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
            arsenal: Arsenal::new(),
            yaw: 0.0,
            pitch: 0.0,
            inputs: VecDeque::new(),
            ack_seq: 0,
            buttons: Buttons::default(),
            health: 0,
            alive: false,
            armor: 0,
            helmet: false,
            respawn_in: None,
            spawn_id: 0,
            protected_for: 0.0,
            money: START_MONEY,
            loadout: (Some(DEFAULT_PRIMARY), WeaponId::Pistol),
            kills: 0,
            deaths: 0,
        };
        if self.free_loadout() {
            player.give_loadout();
        }
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
        self.players
            .values()
            .filter(|p| p.info.team == team)
            .count()
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

    /// Weapons are free (no economy): respawn modes and warmup.
    fn free_loadout(&self) -> bool {
        self.mode.respawns() || self.phase == Phase::Warmup
    }

    fn buy_open(&self) -> bool {
        if self.free_loadout() {
            return true;
        }
        match self.phase {
            Phase::Freeze => true,
            Phase::Live => self.live_elapsed < BUY_TIME,
            _ => false,
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

    // --- Buying -----------------------------------------------------------

    fn buy(&mut self, id: PlayerId, item: BuyItem) {
        let free = self.free_loadout();
        let open = self.buy_open();
        let Some(p) = self.players.get_mut(&id) else {
            return;
        };
        if !p.alive || !open || (!free && !in_buy_zone(p.info.team, p.mv.pos)) {
            return;
        }
        let price = match item {
            BuyItem::Weapon(w) => w.spec().price,
            BuyItem::Kevlar if p.armor >= MAX_ARMOR => return,
            BuyItem::Kevlar => KEVLAR_PRICE,
            BuyItem::KevlarHelmet if p.armor >= MAX_ARMOR && p.helmet => return,
            // Full armor already: only the helmet is left to pay for.
            BuyItem::KevlarHelmet if p.armor >= MAX_ARMOR => KEVLAR_HELMET_PRICE - KEVLAR_PRICE,
            BuyItem::KevlarHelmet => KEVLAR_HELMET_PRICE,
        };
        if !free {
            if p.money < price {
                return;
            }
            p.money -= price;
        }
        match item {
            BuyItem::Weapon(w) => {
                p.arsenal.give(w);
                match w.spec().slot {
                    Slot::Primary => p.loadout.0 = Some(w),
                    Slot::Secondary => p.loadout.1 = w,
                }
            }
            BuyItem::Kevlar => p.armor = MAX_ARMOR,
            BuyItem::KevlarHelmet => {
                p.armor = MAX_ARMOR;
                p.helmet = true;
            }
        }
        self.events.push(GameEvent::Bought { by: id, item });
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
        if self.phase == Phase::Live && self.mode == GameMode::Elimination {
            self.live_elapsed += DT;
            self.update_bomb();
        }
        self.update_rules();
        self.record_history();
        self.publish_status();
        self.broadcast();
        self.tick = self.tick.wrapping_add(1);
    }

    fn apply_inputs(&mut self) -> Vec<PendingShot> {
        let can_act = !matches!(self.phase, Phase::Freeze | Phase::MatchEnd { .. });
        let mut shots = Vec::new();

        for p in self.players.values_mut() {
            for _ in 0..MAX_INPUTS_PER_TICK {
                let Some(cmd) = p.inputs.pop_front() else {
                    break;
                };
                p.ack_seq = cmd.seq;
                p.yaw = cmd.yaw;
                p.pitch = cmd.pitch;
                p.buttons = cmd.buttons;
                if !p.alive {
                    continue;
                }

                // Weapon timers advance per input, same as movement, so
                // fire rate can't be beaten by sending inputs faster. The
                // client predicts with this exact order (shared::wasm).
                if let Some(fired) = p.arsenal.tick(cmd.buttons, can_act) {
                    p.protected_for = 0.0;
                    let spec = fired.weapon.spec();
                    let cone = inaccuracy(
                        spec,
                        p.mv.horizontal_speed(),
                        p.mv.on_ground,
                        p.mv.crouched,
                        p.arsenal.zoomed,
                    );
                    shots.push(PendingShot {
                        shooter: p.info.id,
                        team: p.info.team,
                        weapon: fired.weapon,
                        origin: p.eye(),
                        dir: shot_direction(
                            cmd.yaw,
                            cmd.pitch,
                            spec,
                            fired.spray,
                            cone,
                            shot_random(p.info.id, cmd.seq),
                        ),
                        view_tick: cmd.view_time as f32 / VIEW_TIME_SCALE,
                    });
                }

                p.mv = step(&p.mv, &cmd, can_act, p.arsenal.speed_scale());
            }
        }
        shots
    }

    // --- Lag compensation -----------------------------------------------

    fn record_history(&mut self) {
        let players = self
            .players
            .values()
            .filter(|p| p.alive)
            .map(|p| (p.info.id, p.mv.pos, p.mv.height()))
            .collect();
        self.history.push_back(Frame {
            tick: self.tick,
            players,
        });
        while self.history.len() > HISTORY_TICKS {
            self.history.pop_front();
        }
    }

    /// Where `id` was (feet, height) at fractional server tick `t`, if the
    /// history covers it.
    fn rewound(&self, id: PlayerId, t: f32) -> Option<(Vec3, f32)> {
        let find = |f: &Frame| {
            f.players
                .iter()
                .find(|(pid, ..)| *pid == id)
                .map(|&(_, p, h)| (p, h))
        };
        let b_idx = self.history.iter().position(|f| f.tick as f32 >= t)?;
        let b = &self.history[b_idx];
        let (pb, hb) = find(b)?;
        if b_idx == 0 {
            return Some((pb, hb));
        }
        let a = &self.history[b_idx - 1];
        let Some((pa, _)) = find(a) else {
            return Some((pb, hb));
        };
        let span = (b.tick - a.tick) as f32;
        let k = ((t - a.tick as f32) / span).clamp(0.0, 1.0);
        // A big jump between ticks is a respawn: don't blend across it.
        if (pb - pa).length() > 3.0 {
            return Some((pb, hb));
        }
        Some((pa + (pb - pa) * k, hb))
    }

    fn resolve_shot(&mut self, shot: PendingShot) {
        let teams = self.mode.has_teams();
        // What the shooter saw: at most MAX_REWIND in the past, never ahead.
        let now = self.tick as f32;
        let t = shot
            .view_tick
            .clamp(now - MAX_REWIND * TICK_RATE as f32, now);
        let targets: Vec<Target<PlayerId>> = self
            .players
            .values()
            .filter(|p| {
                p.alive && p.info.id != shot.shooter && (!teams || p.info.team != shot.team)
            })
            .map(|p| {
                let (feet, height) = self
                    .rewound(p.info.id, t)
                    .unwrap_or((p.mv.pos, p.mv.height()));
                Target {
                    id: p.info.id,
                    feet,
                    height,
                }
            })
            .collect();
        let result = trace_shot(shot.origin, shot.dir, targets.into_iter());

        self.events.push(GameEvent::Shot {
            shooter: shot.shooter,
            weapon: shot.weapon,
            from: shot.origin,
            to: result.end,
            hit: result.hit.map(|(id, _)| id),
        });

        let Some((victim_id, zone)) = result.hit else {
            return;
        };
        let Some(victim) = self.players.get_mut(&victim_id) else {
            return;
        };
        if victim.protected_for > 0.0 {
            return;
        }
        let (health, armor) = apply_damage(
            weapon_damage(shot.weapon, zone),
            shot.weapon.spec().armor_pen,
            zone,
            victim.armor,
            victim.helmet,
        );
        victim.armor = victim.armor.saturating_sub(armor);
        victim.health = victim.health.saturating_sub(health);
        if victim.health == 0 {
            self.kill(
                victim_id,
                Some((shot.shooter, shot.team, shot.weapon)),
                zone == HitZone::Head,
            );
        }
    }

    /// `killer` is None for the bomb.
    fn kill(
        &mut self,
        victim_id: PlayerId,
        killer: Option<(PlayerId, Team, WeaponId)>,
        headshot: bool,
    ) {
        let warmup = self.phase == Phase::Warmup;
        let live = self.phase == Phase::Live;
        let respawns = self.mode.respawns();
        let economy = !self.free_loadout() && live;
        let Some(victim) = self.players.get_mut(&victim_id) else {
            return;
        };
        victim.alive = false;
        victim.health = 0;
        victim.deaths += 1;
        let pos = victim.mv.pos;
        if warmup {
            victim.respawn_in = Some(WARMUP_RESPAWN);
        } else if respawns {
            victim.respawn_in = Some(RESPAWN_TIME);
        } else {
            // Elimination: you lose what you carried.
            victim.strip();
        }
        if matches!(self.bomb, BombState::Carried { by, .. } if by == victim_id) {
            self.drop_bomb(pos);
        }
        if let Some((killer_id, team, weapon)) = killer {
            if let Some(k) = self.players.get_mut(&killer_id) {
                k.kills += 1;
                if economy {
                    k.earn(weapon.spec().kill_reward);
                }
            }
            if live && self.mode == GameMode::TeamDeathmatch {
                match team {
                    Team::T => self.score_t += 1,
                    Team::Ct => self.score_ct += 1,
                }
            }
        }
        self.events.push(GameEvent::Kill {
            killer: killer.map_or(victim_id, |k| k.0),
            victim: victim_id,
            headshot,
            weapon: killer.map(|k| k.2),
        });
    }

    // --- Bomb -------------------------------------------------------------

    fn drop_bomb(&mut self, pos: Vec3) {
        self.bomb = BombState::Dropped { pos };
        self.events.push(GameEvent::BombDropped { pos });
    }

    fn update_bomb(&mut self) {
        match self.bomb {
            BombState::Carried { by, planting } => {
                let Some(p) = self.players.get_mut(&by) else {
                    return;
                };
                let site = site_at(p.mv.pos);
                let (Some(site), true) = (site, p.working_objective()) else {
                    self.bomb = BombState::Carried { by, planting: 0.0 };
                    return;
                };
                let planting = planting + DT / PLANT_TIME;
                if planting < 1.0 {
                    self.bomb = BombState::Carried { by, planting };
                    return;
                }
                p.earn(OBJECTIVE_REWARD);
                self.bomb = BombState::Planted {
                    pos: p.mv.pos,
                    site,
                    left: BOMB_TIMER,
                    defuser: None,
                    defusing: 0.0,
                };
                self.planted_this_round = true;
                self.phase_left = BOMB_TIMER;
                self.events.push(GameEvent::BombPlanted { by, site });
            }
            BombState::Dropped { pos } => {
                let carrier = self.players.values().find(|p| {
                    p.alive
                        && p.info.team == Team::T
                        && horizontal_dist(p.mv.pos, pos) <= PICKUP_RANGE
                        && (p.mv.pos.y - pos.y).abs() < 2.0
                });
                if let Some(p) = carrier {
                    let by = p.info.id;
                    self.bomb = BombState::Carried { by, planting: 0.0 };
                    self.events.push(GameEvent::BombPickedUp { by });
                }
            }
            BombState::Planted {
                pos,
                site,
                defuser,
                defusing,
                ..
            } => {
                let can_defuse = |p: &Player| {
                    p.info.team == Team::Ct
                        && p.working_objective()
                        && horizontal_dist(p.mv.pos, pos) <= DEFUSE_RANGE
                        && (p.mv.pos.y - pos.y).abs() < 1.5
                };
                // Keep the current defuser while they stay at it; otherwise
                // the next CT to start from scratch.
                let (defuser, defusing) = match defuser.and_then(|id| self.players.get(&id)) {
                    Some(p) if can_defuse(p) => (Some(p.info.id), defusing + DT / DEFUSE_TIME),
                    _ => match self.players.values().find(|p| can_defuse(p)) {
                        Some(p) => (Some(p.info.id), DT / DEFUSE_TIME),
                        None => (None, 0.0),
                    },
                };
                self.bomb = BombState::Planted {
                    pos,
                    site,
                    left: self.phase_left.max(0.0),
                    defuser,
                    defusing,
                };
                if let (Some(by), true) = (defuser, defusing >= 1.0) {
                    if let Some(p) = self.players.get_mut(&by) {
                        p.earn(OBJECTIVE_REWARD);
                    }
                    self.bomb = BombState::Defused { pos };
                    self.events.push(GameEvent::BombDefused { by });
                    self.end_round(Team::Ct, RoundEndReason::BombDefused);
                }
            }
            BombState::Inactive | BombState::Exploded { .. } | BombState::Defused { .. } => {}
        }
    }

    fn explode(&mut self, pos: Vec3) {
        self.bomb = BombState::Exploded { pos };
        self.events.push(GameEvent::BombExploded { pos });
        let center = Vec3::new(pos.x, pos.y + 0.5, pos.z);
        let mut dead = Vec::new();
        for p in self.players.values_mut().filter(|p| p.alive) {
            let body = Vec3::new(p.mv.pos.x, p.mv.pos.y + 0.9, p.mv.pos.z);
            let d = (body - center).length();
            if d >= BOMB_RADIUS {
                continue;
            }
            let damage = BOMB_DAMAGE * (1.0 - d / BOMB_RADIUS);
            let (health, armor) = apply_damage(damage, 0.6, HitZone::Body, p.armor, p.helmet);
            p.armor = p.armor.saturating_sub(armor);
            p.health = p.health.saturating_sub(health);
            if p.health == 0 {
                dead.push(p.info.id);
            }
        }
        for id in dead {
            self.kill(id, None, false);
        }
    }

    // --- Rules ------------------------------------------------------------

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
                    self.live_elapsed = 0.0;
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
                        self.start_round(false);
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

    /// Elimination: a round ends when a side is wiped, the clock runs out,
    /// or the planted bomb goes off (defusing ends it in `update_bomb`).
    fn check_round_over(&mut self) {
        if let BombState::Planted { pos, .. } = self.bomb {
            // Once planted, attackers dying doesn't matter: the defenders
            // have to defuse.
            if self.phase_left <= 0.0 {
                self.explode(pos);
                self.end_round(Team::T, RoundEndReason::BombExploded);
            } else if self.alive_count(Team::Ct) == 0 {
                self.end_round(Team::T, RoundEndReason::Eliminated);
            }
            return;
        }
        if self.alive_count(Team::T) == 0 {
            self.end_round(Team::Ct, RoundEndReason::Eliminated);
        } else if self.alive_count(Team::Ct) == 0 {
            self.end_round(Team::T, RoundEndReason::Eliminated);
        } else if self.phase_left <= 0.0 {
            self.end_round(Team::Ct, RoundEndReason::TimeUp);
        }
    }

    fn end_round(&mut self, winner: Team, reason: RoundEndReason) {
        // Money: the winners' reward, a growing loss bonus for the losers.
        let loser = winner.other();
        let streak = match loser {
            Team::T => &mut self.loss_streak_t,
            Team::Ct => &mut self.loss_streak_ct,
        };
        let loss_bonus = (LOSS_REWARD + LOSS_STEP * *streak).min(LOSS_MAX);
        *streak = (*streak + 1).min(4);
        match winner {
            Team::T => self.loss_streak_t = 0,
            Team::Ct => self.loss_streak_ct = 0,
        }
        let plant_bonus = if self.planted_this_round {
            PLANT_TEAM_BONUS
        } else {
            0
        };
        for p in self.players.values_mut() {
            if p.info.team == winner {
                p.earn(WIN_REWARD);
            } else if p.info.team == Team::T {
                p.earn(loss_bonus + plant_bonus);
            } else {
                p.earn(loss_bonus);
            }
        }

        let score = match winner {
            Team::T => &mut self.score_t,
            Team::Ct => &mut self.score_ct,
        };
        *score += 1;
        if *score >= ROUNDS_TO_WIN {
            self.end_match(MatchWinner::Team(winner));
        } else {
            self.phase = Phase::RoundEnd { winner, reason };
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
        self.bomb = BombState::Inactive;
        for p in self.players.values_mut() {
            if p.alive {
                p.give_loadout();
            } else {
                p.respawn_in = Some(WARMUP_RESPAWN);
            }
        }
    }

    fn start_match(&mut self) {
        self.score_t = 0;
        self.score_ct = 0;
        self.round = 0;
        self.loss_streak_t = 0;
        self.loss_streak_ct = 0;
        for p in self.players.values_mut() {
            p.kills = 0;
            p.deaths = 0;
            p.money = START_MONEY;
        }
        self.start_round(true);
    }

    /// `fresh`: first round of a match, so nobody keeps their weapons.
    fn start_round(&mut self, fresh: bool) {
        self.round += 1;
        let elimination = self.mode == GameMode::Elimination;
        self.phase = Phase::Freeze;
        self.phase_left = if elimination {
            ELIM_FREEZE_TIME
        } else {
            FREEZE_TIME
        };
        self.live_elapsed = 0.0;
        self.planted_this_round = false;
        self.history.clear();
        // Elimination survivors keep what they carried.
        let survivors: Vec<PlayerId> = self
            .players
            .values()
            .filter(|p| p.alive && !fresh && elimination)
            .map(|p| p.info.id)
            .collect();
        // Kill everyone first so free-for-all spawn picking spreads players
        // out relative to those already placed, not their old positions.
        for p in self.players.values_mut() {
            p.alive = false;
        }
        let ids: Vec<PlayerId> = self.players.keys().copied().collect();
        let (mut t, mut ct) = (0, 0);
        for &id in &ids {
            let team = self.players[&id].info.team;
            let index = match team {
                Team::T => &mut t,
                Team::Ct => &mut ct,
            };
            let (pos, yaw) = self.pick_spawn(team, *index);
            *index += 1;
            let Some(p) = self.players.get_mut(&id) else {
                continue;
            };
            if !elimination {
                p.give_loadout();
            } else if !survivors.contains(&id) {
                p.strip();
            }
            p.spawn_at(pos, yaw, 0.0);
        }

        // One attacker starts with the bomb.
        self.bomb = BombState::Inactive;
        if elimination {
            let attackers: Vec<PlayerId> = ids
                .iter()
                .copied()
                .filter(|id| self.players[id].info.team == Team::T)
                .collect();
            if !attackers.is_empty() {
                let pick = (self.tick as usize).wrapping_mul(2_654_435_761) % attackers.len();
                self.bomb = BombState::Carried {
                    by: attackers[pick],
                    planting: 0.0,
                };
            }
        }
        self.events
            .push(GameEvent::RoundStart { round: self.round });
    }

    fn respawn_dead(&mut self) {
        let mut due = Vec::new();
        for p in self.players.values_mut() {
            let Some(left) = p.respawn_in.as_mut() else {
                continue;
            };
            *left -= DT;
            if *left <= 0.0 {
                due.push((p.info.id, p.info.team));
            }
        }
        let protection = self.protection();
        for (i, (id, team)) in due.into_iter().enumerate() {
            let (pos, yaw) = self.pick_spawn(team, self.tick as usize + i);
            if let Some(p) = self.players.get_mut(&id) {
                p.give_loadout();
                p.spawn_at(pos, yaw, protection);
            }
        }
    }

    /// Update the lobby-facing status; watchers are only woken on change.
    fn publish_status(&self) {
        let (score_t, score_ct) = match self.mode {
            GameMode::Deathmatch => (self.players.values().map(|p| p.kills).max().unwrap_or(0), 0),
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
            buy_open: self.buy_open(),
            bomb: self.bomb,
            players: self.players.values().map(Player::snap).collect(),
            you: None,
            events: std::mem::take(&mut self.events),
        };
        for p in self.players.values() {
            snapshot.ack_seq = p.ack_seq;
            snapshot.you = Some(p.arsenal);
            let frame = protocol::encode(&ServerMsg::Snapshot(snapshot.clone()));
            // A full buffer means the client is too slow: drop this snapshot,
            // the next one carries the full state anyway. Events are lost in
            // that case, which only affects cosmetics (killfeed, tracers).
            let _ = p.out.try_send(frame.into());
        }
    }
}

fn horizontal_dist(a: Vec3, b: Vec3) -> f32 {
    let (dx, dz) = (a.x - b.x, a.z - b.z);
    (dx * dx + dz * dz).sqrt()
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

    fn place(room: &mut Room, id: PlayerId, pos: Vec3) {
        let p = room.players.get_mut(&id).unwrap();
        p.mv = MoveState {
            pos,
            on_ground: true,
            ..Default::default()
        };
    }

    fn input(room: &mut Room, id: PlayerId, buttons: u16, view_time: u32) {
        let p = room.players.get_mut(&id).unwrap();
        p.inputs.push_back(InputCmd {
            seq: p.ack_seq + 1,
            buttons: Buttons(buttons),
            view_time,
            ..Default::default()
        });
    }

    /// Ready the shooter's weapon and fire one shot straight down -Z,
    /// seeing the present (no rewind).
    fn fire(room: &mut Room, shooter: PlayerId) {
        let p = room.players.get_mut(&shooter).unwrap();
        p.arsenal.fire_cooldown = 0.0;
        p.arsenal.draw_left = 0.0;
        p.arsenal.fire_held = false;
        let now = room.tick * VIEW_TIME_SCALE as u32;
        input(room, shooter, Buttons::FIRE, now);
        room.update();
    }

    /// Put `shooter` 6 m behind `target` in the open west lane and fire one
    /// shot at head height.
    fn headshot(room: &mut Room, shooter: PlayerId, target: PlayerId) {
        place(room, shooter, Vec3::new(-25.0, 0.0, 28.0));
        place(room, target, Vec3::new(-25.0, 0.0, 22.0));
        fire(room, shooter);
    }

    fn team_of(room: &Room, team: Team) -> PlayerId {
        room.players
            .values()
            .find(|p| p.info.team == team)
            .unwrap()
            .info
            .id
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
        assert!(
            b_state.alive && b_state.spawn_id != spawn_before,
            "b respawned"
        );
        assert!(b_state.protected_for > 0.0, "fresh spawn is protected");
        assert_eq!(b_state.arsenal.weapon(), DEFAULT_PRIMARY, "free loadout");

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
        let score = if team == Team::T {
            r.score_t
        } else {
            r.score_ct
        };
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
        assert_eq!(
            r.players[&a].arsenal.weapon(),
            WeaponId::Pistol,
            "pistol round"
        );
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

    #[test]
    fn lag_compensation_hits_where_the_shooter_saw_the_target() {
        let mut r = room(GameMode::Deathmatch);
        let a = join(&mut r, "a");
        let b = join(&mut r, "b");
        until_live(&mut r);
        // b stands in front of a for a few ticks, then steps 3 m aside.
        place(&mut r, a, Vec3::new(-25.0, 0.0, 28.0));
        place(&mut r, b, Vec3::new(-25.0, 0.0, 22.0));
        ticks(&mut r, 4);
        let seen = r.tick - 2;
        place(&mut r, b, Vec3::new(-22.0, 0.0, 22.0));
        ticks(&mut r, 6);
        r.players.get_mut(&b).unwrap().protected_for = 0.0;

        // Shooting at the present misses...
        fire(&mut r, a);
        assert_eq!(r.players[&b].health, MAX_HEALTH);
        // ...shooting at what a saw ~8 ticks ago hits.
        let p = r.players.get_mut(&a).unwrap();
        p.arsenal.fire_cooldown = 0.0;
        p.arsenal.fire_held = false;
        input(&mut r, a, Buttons::FIRE, seen * VIEW_TIME_SCALE as u32);
        r.update();
        assert!(!r.players[&b].alive, "rewound headshot kills");
    }

    #[test]
    fn rewind_is_capped() {
        let mut r = room(GameMode::Deathmatch);
        let a = join(&mut r, "a");
        let b = join(&mut r, "b");
        until_live(&mut r);
        place(&mut r, a, Vec3::new(-25.0, 0.0, 28.0));
        place(&mut r, b, Vec3::new(-25.0, 0.0, 22.0));
        ticks(&mut r, 2);
        let seen = r.tick;
        place(&mut r, b, Vec3::new(-22.0, 0.0, 22.0));
        // Far longer ago than MAX_REWIND allows.
        ticks(&mut r, (MAX_REWIND * 2.0 / DT) as usize);
        r.players.get_mut(&b).unwrap().protected_for = 0.0;
        let p = r.players.get_mut(&a).unwrap();
        p.arsenal.fire_cooldown = 0.0;
        input(&mut r, a, Buttons::FIRE, seen * VIEW_TIME_SCALE as u32);
        r.update();
        assert_eq!(r.players[&b].health, MAX_HEALTH);
    }

    /// Elimination room with one attacker and one defender, live.
    fn bomb_room() -> (Room, PlayerId, PlayerId) {
        let mut r = room(GameMode::Elimination);
        join(&mut r, "a");
        join(&mut r, "b");
        until_live(&mut r);
        let t = team_of(&r, Team::T);
        let ct = team_of(&r, Team::Ct);
        assert!(matches!(r.bomb, BombState::Carried { by, .. } if by == t));
        (r, t, ct)
    }

    fn plant(r: &mut Room, t: PlayerId) {
        place(r, t, Vec3::new(-21.0, 0.0, -14.0));
        for _ in 0..((PLANT_TIME / DT) as usize + 2) {
            input(r, t, Buttons::USE, 0);
            r.update();
        }
        assert!(
            matches!(r.bomb, BombState::Planted { site: 0, .. }),
            "{:?}",
            r.bomb
        );
    }

    #[test]
    fn planted_bomb_explodes_for_an_attacker_win() {
        let (mut r, t, ct) = bomb_room();
        let money = r.players[&t].money;
        plant(&mut r, t);
        assert_eq!(r.players[&t].money, money + OBJECTIVE_REWARD);
        // The defender is too far away to die but loses the round.
        place(&mut r, ct, Vec3::new(0.0, 0.0, 26.0));
        place(&mut r, t, Vec3::new(-24.0, 0.0, -14.0));
        ticks(&mut r, (BOMB_TIMER / DT) as usize + 2);
        assert_eq!(
            r.phase,
            Phase::RoundEnd {
                winner: Team::T,
                reason: RoundEndReason::BombExploded
            }
        );
        assert!(!r.players[&t].alive, "the planter stayed next to it");
        assert!(r.players[&ct].alive);
    }

    #[test]
    fn defusing_wins_the_round_even_with_attackers_dead() {
        let (mut r, t, ct) = bomb_room();
        plant(&mut r, t);
        // The attacker dying doesn't end a planted round.
        r.kill(t, None, false);
        r.update();
        assert_eq!(r.phase, Phase::Live);
        place(&mut r, ct, Vec3::new(-21.5, 0.0, -14.5));
        for _ in 0..((DEFUSE_TIME / DT) as usize + 2) {
            input(&mut r, ct, Buttons::USE, 0);
            r.update();
        }
        assert_eq!(
            r.phase,
            Phase::RoundEnd {
                winner: Team::Ct,
                reason: RoundEndReason::BombDefused
            }
        );
    }

    #[test]
    fn dead_carrier_drops_the_bomb_for_a_teammate() {
        let mut r = room(GameMode::Elimination);
        let ids: Vec<_> = ["a", "b", "c"].iter().map(|n| join(&mut r, n)).collect();
        until_live(&mut r);
        let BombState::Carried { by, .. } = r.bomb else {
            panic!()
        };
        let mate = *ids
            .iter()
            .find(|&&id| id != by && r.players[&id].info.team == Team::T)
            .unwrap();
        place(&mut r, by, Vec3::new(-25.0, 0.0, 10.0));
        r.kill(by, None, false);
        assert!(matches!(r.bomb, BombState::Dropped { .. }));
        place(&mut r, mate, Vec3::new(-25.5, 0.0, 10.0));
        r.update();
        assert!(matches!(r.bomb, BombState::Carried { by, .. } if by == mate));
    }

    #[test]
    fn buying_costs_money_and_needs_the_buy_zone() {
        let mut r = room(GameMode::Elimination);
        let a = join(&mut r, "a");
        join(&mut r, "b");
        until_live(&mut r);
        // 800 start money can't afford a rifle.
        r.buy(a, BuyItem::Weapon(WeaponId::Rifle));
        assert_eq!(r.players[&a].arsenal.weapon(), WeaponId::Pistol);
        r.buy(a, BuyItem::Kevlar);
        assert_eq!(r.players[&a].armor, MAX_ARMOR);
        assert_eq!(r.players[&a].money, START_MONEY - KEVLAR_PRICE);

        r.players.get_mut(&a).unwrap().money = 5000;
        place(&mut r, a, Vec3::new(0.0, 0.0, 0.0));
        r.buy(a, BuyItem::Weapon(WeaponId::Rifle));
        assert_eq!(r.players[&a].money, 5000, "outside the buy zone");

        let team = r.players[&a].info.team;
        place(&mut r, a, spawn_point(team, 0));
        r.buy(a, BuyItem::Weapon(WeaponId::Rifle));
        assert_eq!(r.players[&a].arsenal.weapon(), WeaponId::Rifle);
        assert_eq!(r.players[&a].money, 5000 - WeaponId::Rifle.spec().price);

        r.live_elapsed = BUY_TIME + 1.0;
        r.buy(a, BuyItem::Weapon(WeaponId::Smg));
        assert_eq!(
            r.players[&a].arsenal.weapon(),
            WeaponId::Rifle,
            "buy time is over"
        );
    }

    #[test]
    fn round_rewards_and_survivors_keep_their_weapons() {
        let (mut r, t, ct) = bomb_room();
        r.players.get_mut(&t).unwrap().arsenal.give(WeaponId::Smg);
        let (t_money, ct_money) = (r.players[&t].money, r.players[&ct].money);
        r.kill(ct, Some((t, Team::T, WeaponId::Smg)), false);
        r.update();
        assert!(matches!(
            r.phase,
            Phase::RoundEnd {
                winner: Team::T,
                ..
            }
        ));
        let reward = WeaponId::Smg.spec().kill_reward;
        assert_eq!(r.players[&t].money, t_money + reward + WIN_REWARD);
        assert_eq!(r.players[&ct].money, ct_money + LOSS_REWARD);

        ticks(&mut r, (ROUND_END_TIME / DT) as usize + 2);
        assert_eq!(r.phase, Phase::Freeze);
        assert!(
            r.players[&t].arsenal.primary.is_some(),
            "survivor keeps the SMG"
        );
        assert!(r.players[&ct].arsenal.primary.is_none());
    }
}
