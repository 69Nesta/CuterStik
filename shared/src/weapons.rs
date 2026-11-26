//! Weapons: stats, the per-player weapon state machine (`Arsenal`), spray
//! patterns and spread. The server runs `Arsenal::tick` for every input and
//! the client runs the same code to predict its own shots and ammo.

use serde::{Deserialize, Serialize};

use crate::constants::*;
use crate::protocol::Buttons;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WeaponId {
    Pistol,
    HandCannon,
    Smg,
    Rifle,
    Sniper,
}

impl WeaponId {
    pub const ALL: [WeaponId; 5] = [
        WeaponId::Pistol,
        WeaponId::HandCannon,
        WeaponId::Smg,
        WeaponId::Rifle,
        WeaponId::Sniper,
    ];

    pub fn spec(self) -> &'static WeaponSpec {
        &SPECS[self as usize]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Slot {
    Primary,
    Secondary,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct WeaponSpec {
    pub id: WeaponId,
    pub name: &'static str,
    pub slot: Slot,
    /// 0 = not for sale (the default pistol).
    pub price: u16,
    pub mag: u8,
    pub reserve: u16,
    pub fire_interval: f32,
    pub reload_time: f32,
    /// Holding the trigger keeps firing; otherwise one shot per click.
    pub auto: bool,
    pub body_damage: f32,
    pub head_damage: f32,
    /// Share of the damage that goes through armor.
    pub armor_pen: f32,
    /// Inaccuracy in radians: standing still, extra at full run speed,
    /// extra while airborne. Crouching scales the total by 0.75.
    pub spread: f32,
    pub spread_move: f32,
    pub spread_air: f32,
    /// Weapons with a scope: inaccuracy while zoomed.
    pub scoped_spread: Option<f32>,
    /// Recoil: pitch kick per shot for the first `climb_shots` shots, then
    /// a side-to-side sway of `sway` radians. `recovery` is how many shots
    /// of spray wear off per second once you stop firing.
    pub kick: f32,
    pub climb_shots: f32,
    pub sway: f32,
    pub recovery: f32,
    /// Movement speed multiplier while this weapon is out.
    pub speed: f32,
    pub kill_reward: u16,
}

const SPECS: [WeaponSpec; 5] = [
    WeaponSpec {
        id: WeaponId::Pistol,
        name: "Pistol",
        slot: Slot::Secondary,
        price: 0,
        mag: 12,
        reserve: 48,
        fire_interval: 0.15,
        reload_time: 2.2,
        auto: false,
        body_damage: 26.0,
        head_damage: 104.0,
        armor_pen: 0.47,
        spread: 0.006,
        spread_move: 0.025,
        spread_air: 0.1,
        scoped_spread: None,
        kick: 0.012,
        climb_shots: 3.0,
        sway: 0.0,
        recovery: 6.0,
        speed: 1.0,
        kill_reward: 300,
    },
    WeaponSpec {
        id: WeaponId::HandCannon,
        name: "Hand Cannon",
        slot: Slot::Secondary,
        price: 700,
        mag: 7,
        reserve: 35,
        fire_interval: 0.25,
        reload_time: 2.2,
        auto: false,
        body_damage: 52.0,
        head_damage: 180.0,
        armor_pen: 0.93,
        spread: 0.004,
        spread_move: 0.05,
        spread_air: 0.15,
        scoped_spread: None,
        kick: 0.03,
        climb_shots: 2.0,
        sway: 0.0,
        recovery: 3.0,
        speed: 0.96,
        kill_reward: 300,
    },
    WeaponSpec {
        id: WeaponId::Smg,
        name: "SMG",
        slot: Slot::Primary,
        price: 1250,
        mag: 30,
        reserve: 120,
        fire_interval: 0.075,
        reload_time: 2.4,
        auto: true,
        body_damage: 26.0,
        head_damage: 85.0,
        armor_pen: 0.6,
        spread: 0.009,
        spread_move: 0.015,
        spread_air: 0.08,
        scoped_spread: None,
        kick: 0.006,
        climb_shots: 8.0,
        sway: 0.012,
        recovery: 10.0,
        speed: 1.0,
        kill_reward: 600,
    },
    WeaponSpec {
        id: WeaponId::Rifle,
        name: "Rifle",
        slot: Slot::Primary,
        price: 2700,
        mag: 30,
        reserve: 90,
        fire_interval: 0.1,
        reload_time: 2.5,
        auto: true,
        body_damage: 32.0,
        head_damage: 130.0,
        armor_pen: 0.78,
        spread: 0.0035,
        spread_move: 0.05,
        spread_air: 0.12,
        scoped_spread: None,
        kick: 0.011,
        climb_shots: 9.0,
        sway: 0.025,
        recovery: 8.0,
        speed: 0.92,
        kill_reward: 300,
    },
    WeaponSpec {
        id: WeaponId::Sniper,
        name: "Sniper",
        slot: Slot::Primary,
        price: 4750,
        mag: 5,
        reserve: 20,
        fire_interval: 1.3,
        reload_time: 3.5,
        auto: false,
        body_damage: 115.0,
        head_damage: 400.0,
        armor_pen: 0.97,
        spread: 0.07,
        spread_move: 0.12,
        spread_air: 0.25,
        scoped_spread: Some(0.0006),
        kick: 0.05,
        climb_shots: 1.0,
        sway: 0.0,
        recovery: 2.0,
        speed: 0.84,
        kill_reward: 100,
    },
];

/// Speed multiplier while scoped in, on top of the weapon's own.
pub const SCOPED_SPEED: f32 = 0.7;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Gun {
    pub id: WeaponId,
    pub ammo: u8,
    pub reserve: u16,
}

impl Gun {
    pub fn full(id: WeaponId) -> Self {
        let s = id.spec();
        Self {
            id,
            ammo: s.mag,
            reserve: s.reserve,
        }
    }
}

/// A shot that left the barrel this tick.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Fired {
    pub weapon: WeaponId,
    /// Spray accumulated before this shot (drives the recoil pattern).
    pub spray: f32,
}

/// Everything a player carries and the timers that gate firing.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Arsenal {
    pub primary: Option<Gun>,
    pub secondary: Gun,
    pub active: Slot,
    pub fire_cooldown: f32,
    pub reload_left: f32,
    pub draw_left: f32,
    pub spray: f32,
    /// Trigger state last tick, so semi-auto weapons fire once per click.
    pub fire_held: bool,
    pub zoomed: bool,
}

impl Default for Arsenal {
    fn default() -> Self {
        Self::new()
    }
}

impl Arsenal {
    /// Default pistol only.
    pub fn new() -> Self {
        Self {
            primary: None,
            secondary: Gun::full(WeaponId::Pistol),
            active: Slot::Secondary,
            fire_cooldown: 0.0,
            reload_left: 0.0,
            draw_left: 0.0,
            spray: 0.0,
            fire_held: false,
            zoomed: false,
        }
    }

    /// A loadout with `primary` out and ready.
    pub fn with_primary(primary: WeaponId) -> Self {
        let mut a = Self::new();
        a.primary = Some(Gun::full(primary));
        a.active = Slot::Primary;
        a
    }

    pub fn gun(&self) -> &Gun {
        match (self.active, &self.primary) {
            (Slot::Primary, Some(g)) => g,
            _ => &self.secondary,
        }
    }

    fn gun_mut(&mut self) -> &mut Gun {
        match (self.active, &mut self.primary) {
            (Slot::Primary, Some(g)) => g,
            _ => &mut self.secondary,
        }
    }

    pub fn weapon(&self) -> WeaponId {
        self.gun().id
    }

    pub fn spec(&self) -> &'static WeaponSpec {
        self.weapon().spec()
    }

    pub fn reloading(&self) -> bool {
        self.reload_left > 0.0
    }

    pub fn speed_scale(&self) -> f32 {
        self.spec().speed * if self.zoomed { SCOPED_SPEED } else { 1.0 }
    }

    /// Put a fresh weapon in its slot and pull it out.
    pub fn give(&mut self, id: WeaponId) {
        let gun = Gun::full(id);
        match id.spec().slot {
            Slot::Primary => self.primary = Some(gun),
            Slot::Secondary => self.secondary = gun,
        }
        self.active = id.spec().slot;
        self.start_draw();
    }

    /// Refill every magazine and reserve (new round, respawn).
    pub fn refill(&mut self) {
        if let Some(g) = &mut self.primary {
            *g = Gun::full(g.id);
        }
        self.secondary = Gun::full(self.secondary.id);
        self.fire_cooldown = 0.0;
        self.reload_left = 0.0;
        self.draw_left = 0.0;
        self.spray = 0.0;
        self.zoomed = false;
    }

    pub fn switch(&mut self, slot: Slot) {
        if slot == self.active || (slot == Slot::Primary && self.primary.is_none()) {
            return;
        }
        self.active = slot;
        self.start_draw();
    }

    fn start_draw(&mut self) {
        self.draw_left = DRAW_TIME;
        self.reload_left = 0.0;
        self.spray = 0.0;
        self.zoomed = false;
    }

    /// Advance one input tick. Returns the shot fired this tick, if any.
    pub fn tick(&mut self, buttons: Buttons, can_fire: bool) -> Option<Fired> {
        if buttons.has(Buttons::SLOT1) {
            self.switch(Slot::Primary);
        } else if buttons.has(Buttons::SLOT2) {
            self.switch(Slot::Secondary);
        }

        self.fire_cooldown = (self.fire_cooldown - DT).max(0.0);
        self.draw_left = (self.draw_left - DT).max(0.0);
        if self.reload_left > 0.0 {
            self.reload_left -= DT;
            if self.reload_left <= 0.0 {
                self.reload_left = 0.0;
                let mag = self.spec().mag;
                let g = self.gun_mut();
                let take = ((mag - g.ammo) as u16).min(g.reserve);
                g.ammo += take as u8;
                g.reserve -= take;
            }
        }

        let spec = self.spec();
        let gun = *self.gun();
        if buttons.has(Buttons::RELOAD)
            && !self.reloading()
            && gun.ammo < spec.mag
            && gun.reserve > 0
        {
            self.reload_left = spec.reload_time;
        }
        self.zoomed = buttons.has(Buttons::ZOOM)
            && spec.scoped_spread.is_some()
            && !self.reloading()
            && self.draw_left == 0.0;

        let fire = buttons.has(Buttons::FIRE);
        let trigger = fire && (spec.auto || !self.fire_held);
        self.fire_held = fire;

        if trigger
            && can_fire
            && self.fire_cooldown <= 0.0
            && self.draw_left == 0.0
            && !self.reloading()
            && gun.ammo > 0
        {
            let spray = self.spray;
            self.spray += 1.0;
            self.fire_cooldown = spec.fire_interval;
            let g = self.gun_mut();
            g.ammo -= 1;
            if g.ammo == 0 && g.reserve > 0 {
                self.reload_left = spec.reload_time;
                self.zoomed = false;
            }
            return Some(Fired {
                weapon: spec.id,
                spray,
            });
        }
        if self.fire_cooldown <= 0.0 {
            self.spray = (self.spray - spec.recovery * DT).max(0.0);
        }
        None
    }
}

/// Recoil offset (pitch up, yaw) in radians after `spray` shots.
pub fn spray_offset(spec: &WeaponSpec, spray: f32) -> (f32, f32) {
    let climb = spray.min(spec.climb_shots);
    let pitch = spec.kick * (climb + (spray - climb).max(0.0) * 0.2);
    let ramp = ((spray - 3.0) / 4.0).clamp(0.0, 1.0);
    let yaw = spec.sway * libm::sinf(spray * 0.6) * ramp;
    (pitch, yaw)
}

/// Current inaccuracy cone (radians) for a weapon given how you move.
pub fn inaccuracy(
    spec: &WeaponSpec,
    horizontal_speed: f32,
    on_ground: bool,
    crouched: bool,
    zoomed: bool,
) -> f32 {
    let base = match (zoomed, spec.scoped_spread) {
        (true, Some(s)) => s,
        _ => spec.spread,
    };
    // Walking speed is accurate; full run speed costs the whole penalty.
    let walk = MAX_SPEED * WALK_SPEED_FACTOR;
    let moving = ((horizontal_speed - walk) / (MAX_SPEED - walk)).clamp(0.0, 1.0);
    let air = if on_ground { 0.0 } else { spec.spread_air };
    let total = base + spec.spread_move * moving + air;
    if crouched && on_ground {
        total * 0.75
    } else {
        total
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn press(b: u16) -> Buttons {
        Buttons(b)
    }

    #[test]
    fn semi_auto_needs_a_click_per_shot() {
        let mut a = Arsenal::new();
        let mut shots = 0;
        for _ in 0..64 {
            shots += a.tick(press(Buttons::FIRE), true).is_some() as u32;
        }
        assert_eq!(shots, 1);
    }

    #[test]
    fn auto_rifle_empties_and_reloads_from_reserve() {
        let mut a = Arsenal::with_primary(WeaponId::Rifle);
        let mut shots = 0;
        for _ in 0..(64 * 7) {
            shots += a.tick(press(Buttons::FIRE), true).is_some() as u32;
        }
        let g = a.gun();
        // 30 shots, then a 2.5 s reload, then more shots.
        assert!(shots > 30, "{shots}");
        assert_eq!(g.reserve, 60);
    }

    #[test]
    fn switching_has_a_draw_delay() {
        let mut a = Arsenal::with_primary(WeaponId::Rifle);
        assert!(a.tick(press(Buttons::SLOT2), true).is_none());
        assert_eq!(a.weapon(), WeaponId::Pistol);
        assert!(
            a.tick(press(Buttons::FIRE), true).is_none(),
            "still drawing"
        );
        for _ in 0..40 {
            a.tick(press(0), true);
        }
        assert!(a.tick(press(Buttons::FIRE), true).is_some());
    }

    #[test]
    fn spray_climbs_then_recovers() {
        let spec = WeaponId::Rifle.spec();
        let (p1, _) = spray_offset(spec, 1.0);
        let (p8, _) = spray_offset(spec, 8.0);
        assert!(p8 > p1 * 5.0);
        let mut a = Arsenal::with_primary(WeaponId::Rifle);
        for _ in 0..40 {
            a.tick(press(Buttons::FIRE), true);
        }
        assert!(a.spray > 5.0);
        for _ in 0..128 {
            a.tick(press(0), true);
        }
        assert_eq!(a.spray, 0.0);
    }

    #[test]
    fn only_snipers_scope() {
        let mut a = Arsenal::with_primary(WeaponId::Sniper);
        a.tick(press(Buttons::ZOOM), true);
        assert!(a.zoomed);
        assert!(a.speed_scale() < 0.7);
        let mut r = Arsenal::with_primary(WeaponId::Rifle);
        r.tick(press(Buttons::ZOOM), true);
        assert!(!r.zoomed);
    }
}
