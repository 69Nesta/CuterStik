//! Static map geometry. This one list is the single source of truth: the
//! server collides against it and the client renders it (through wasm).

use std::sync::OnceLock;

use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

use crate::math::{Aabb, Vec3};
use crate::protocol::Team;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Surface {
    Floor,
    Wall,
    Crate,
    Platform,
    Stairs,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MapBox {
    pub bounds: Aabb,
    pub surface: Surface,
}

const fn b(min: [f32; 3], max: [f32; 3], surface: Surface) -> MapBox {
    MapBox {
        bounds: Aabb::new(
            Vec3::new(min[0], min[1], min[2]),
            Vec3::new(max[0], max[1], max[2]),
        ),
        surface,
    }
}

use Surface::*;

/// "Yard": a three-lane layout. T spawn is south (+Z), CT spawn north (-Z),
/// with site A on the west and site B on the east.
pub const MAP: &[MapBox] = &[
    // Ground
    b([-32.0, -1.0, -32.0], [32.0, 0.0, 32.0], Floor),
    // Outer walls
    b([-32.0, 0.0, -32.0], [32.0, 6.0, -31.0], Wall),
    b([-32.0, 0.0, 31.0], [32.0, 6.0, 32.0], Wall),
    b([-32.0, 0.0, -31.0], [-31.0, 6.0, 31.0], Wall),
    b([31.0, 0.0, -31.0], [32.0, 6.0, 31.0], Wall),
    // Lane dividers, with a connector gap around z = 0
    b([-11.0, 0.0, -15.0], [-9.0, 4.0, -3.0], Wall),
    b([-11.0, 0.0, 3.0], [-9.0, 4.0, 15.0], Wall),
    b([9.0, 0.0, -15.0], [11.0, 4.0, -3.0], Wall),
    b([9.0, 0.0, 3.0], [11.0, 4.0, 15.0], Wall),
    // Mid cover
    b([-1.5, 0.0, -1.5], [1.5, 1.1, 1.5], Crate),
    b([-4.0, 0.0, 8.0], [-2.0, 2.0, 10.0], Crate),
    b([2.0, 0.0, -10.0], [4.0, 2.0, -8.0], Crate),
    // Site A (west)
    b([-24.0, 0.0, -22.0], [-21.0, 1.2, -19.0], Crate),
    b([-20.0, 0.0, -25.0], [-18.0, 3.0, -23.0], Crate),
    b([-16.0, 0.0, -18.0], [-14.0, 1.0, -16.0], Crate),
    b([-29.0, 0.0, -14.0], [-25.0, 1.0, -10.0], Platform),
    // Site B (east)
    b([16.0, 0.0, -22.0], [19.0, 2.0, -19.0], Crate),
    b([22.0, 0.0, -18.0], [24.0, 1.0, -16.0], Crate),
    b([20.0, 0.0, -28.0], [28.0, 1.0, -24.0], Platform),
    b([25.0, 1.0, -28.0], [28.0, 2.2, -26.0], Crate),
    // T side cover
    b([-4.0, 0.0, 18.0], [4.0, 1.2, 19.0], Wall),
    b([-20.0, 0.0, 10.0], [-17.0, 2.0, 13.0], Crate),
    b([17.0, 0.0, 10.0], [20.0, 2.0, 13.0], Crate),
    // CT side cover
    b([-3.0, 0.0, -20.0], [3.0, 2.5, -19.0], Wall),
    // Stairs up to the site B platform (from the south)
    b([20.0, 0.0, -24.0], [23.0, 0.75, -23.3], Stairs),
    b([20.0, 0.0, -23.3], [23.0, 0.5, -22.6], Stairs),
    b([20.0, 0.0, -22.6], [23.0, 0.25, -21.9], Stairs),
];

/// Direction a ramp climbs toward.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Rise {
    PosX,
    NegX,
    PosZ,
    NegZ,
}

/// A slope filling `bounds`: `min.y` at its low end, `max.y` at the high
/// end. Collision approximates it with thin steps (see `colliders`) that
/// the step-up in `movement` walks over smoothly.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Ramp {
    pub bounds: Aabb,
    pub rise: Rise,
}

const fn r(min: [f32; 3], max: [f32; 3], rise: Rise) -> Ramp {
    Ramp {
        bounds: Aabb::new(
            Vec3::new(min[0], min[1], min[2]),
            Vec3::new(max[0], max[1], max[2]),
        ),
        rise,
    }
}

pub const RAMPS: &[Ramp] = &[
    // Up to the site A platform, from the south.
    r([-29.0, 0.0, -10.0], [-25.0, 1.0, -5.0], Rise::NegZ),
    // Site A perch: up onto the tall crate.
    r([-20.0, 0.0, -23.0], [-18.0, 3.0, -17.0], Rise::NegZ),
];

/// Rise of one collision step on a ramp.
const RAMP_STEP: f32 = 0.08;

fn ramp_steps(ramp: &Ramp, out: &mut Vec<Aabb>) {
    let Aabb { min, max } = ramp.bounds;
    let rise = max.y - min.y;
    let n = libm::ceilf(rise / RAMP_STEP).max(1.0) as usize;
    for i in 0..n {
        // Each step runs from its start to the high end, topped at the
        // slope's height in the middle of the step.
        let h = min.y + rise * (i as f32 + 0.5) / n as f32;
        let f = i as f32 / n as f32;
        let (mut lo, mut hi) = (min, max);
        hi.y = h;
        match ramp.rise {
            Rise::PosX => lo.x = min.x + (max.x - min.x) * f,
            Rise::NegX => hi.x = max.x - (max.x - min.x) * f,
            Rise::PosZ => lo.z = min.z + (max.z - min.z) * f,
            Rise::NegZ => hi.z = max.z - (max.z - min.z) * f,
        }
        out.push(Aabb::new(lo, hi));
    }
}

/// Every solid box: the map plus ramp steps. Movement and hitscan use this.
pub fn colliders() -> &'static [Aabb] {
    static ALL: OnceLock<Vec<Aabb>> = OnceLock::new();
    ALL.get_or_init(|| {
        let mut v: Vec<Aabb> = MAP.iter().map(|m| m.bounds).collect();
        for ramp in RAMPS {
            ramp_steps(ramp, &mut v);
        }
        v
    })
}

/// Where the bomb can be planted: a circle on the ground around each site.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct BombSite {
    pub label: &'static str,
    pub x: f32,
    pub z: f32,
    pub radius: f32,
}

pub const BOMB_SITES: &[BombSite] = &[
    BombSite {
        label: "A",
        x: -21.0,
        z: -15.0,
        radius: 5.5,
    },
    BombSite {
        label: "B",
        x: 19.0,
        z: -13.0,
        radius: 5.5,
    },
];

/// Index into `BOMB_SITES` of the site `pos` stands in.
pub fn site_at(pos: Vec3) -> Option<u8> {
    BOMB_SITES
        .iter()
        .position(|s| {
            let (dx, dz) = (pos.x - s.x, pos.z - s.z);
            dx * dx + dz * dz <= s.radius * s.radius
        })
        .map(|i| i as u8)
}

/// Buy zones (x/z rectangles around each spawn).
#[derive(Debug, Clone, Copy, Serialize)]
pub struct BuyZone {
    pub team: Team,
    pub min_x: f32,
    pub min_z: f32,
    pub max_x: f32,
    pub max_z: f32,
}

pub const BUY_ZONES: &[BuyZone] = &[
    BuyZone {
        team: Team::T,
        min_x: -12.0,
        min_z: 21.0,
        max_x: 12.0,
        max_z: 31.0,
    },
    BuyZone {
        team: Team::Ct,
        min_x: -12.0,
        min_z: -31.0,
        max_x: 12.0,
        max_z: -21.0,
    },
];

pub fn in_buy_zone(team: Team, pos: Vec3) -> bool {
    BUY_ZONES.iter().any(|z| {
        z.team == team
            && pos.x >= z.min_x
            && pos.x <= z.max_x
            && pos.z >= z.min_z
            && pos.z <= z.max_z
    })
}

const T_SPAWNS: &[Vec3] = &[
    Vec3::new(0.0, 0.0, 26.0),
    Vec3::new(-3.0, 0.0, 26.0),
    Vec3::new(3.0, 0.0, 26.0),
    Vec3::new(-6.0, 0.0, 27.0),
    Vec3::new(6.0, 0.0, 27.0),
];

const CT_SPAWNS: &[Vec3] = &[
    Vec3::new(0.0, 0.0, -26.0),
    Vec3::new(-3.0, 0.0, -26.0),
    Vec3::new(3.0, 0.0, -26.0),
    Vec3::new(-6.0, 0.0, -27.0),
    Vec3::new(6.0, 0.0, -27.0),
];

/// Free-for-all spawns spread over the whole map. The server picks the one
/// farthest from living players.
pub const DM_SPAWNS: &[Vec3] = &[
    Vec3::new(-27.0, 0.0, 27.0),
    Vec3::new(27.0, 0.0, 27.0),
    Vec3::new(-27.0, 0.0, 0.0),
    Vec3::new(27.0, 0.0, 0.0),
    Vec3::new(-20.0, 0.0, -28.0),
    Vec3::new(14.0, 0.0, -28.0),
    Vec3::new(0.0, 0.0, 5.0),
    Vec3::new(-14.0, 0.0, 22.0),
    Vec3::new(14.0, 0.0, 22.0),
    Vec3::new(-5.0, 0.0, -12.0),
    Vec3::new(6.0, 0.0, -14.0),
    Vec3::new(20.0, 0.0, -10.0),
    Vec3::new(-24.0, 0.0, -6.0),
];

/// Yaw that looks toward the middle of the map from `pos`.
pub fn yaw_to_center(pos: Vec3) -> f32 {
    libm::atan2f(pos.x, pos.z)
}

pub fn spawn_point(team: Team, index: usize) -> Vec3 {
    let list = match team {
        Team::T => T_SPAWNS,
        Team::Ct => CT_SPAWNS,
    };
    list[index % list.len()]
}

/// Yaw that faces the enemy side from a team's spawn.
pub fn spawn_yaw(team: Team) -> f32 {
    match team {
        Team::T => 0.0,                    // look toward -Z
        Team::Ct => core::f32::consts::PI, // look toward +Z
    }
}

/// Nearest distance at which a ray hits map geometry.
pub fn raycast_map(origin: Vec3, dir: Vec3, max_dist: f32) -> Option<f32> {
    colliders()
        .iter()
        .filter_map(|m| m.ray_hit(origin, dir, max_dist))
        .min_by(f32::total_cmp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{PLAYER_HEIGHT, STEP_HEIGHT};
    use crate::movement::player_bounds;

    #[test]
    fn spawns_are_clear_of_geometry() {
        let all = T_SPAWNS.iter().chain(CT_SPAWNS).chain(DM_SPAWNS);
        for &p in all {
            let me = player_bounds(Vec3::new(p.x, p.y + 0.001, p.z), PLAYER_HEIGHT);
            assert!(
                !colliders().iter().any(|m| me.overlaps(m)),
                "spawn {p:?} is inside geometry"
            );
        }
    }

    #[test]
    fn ramp_steps_climb_to_the_top() {
        let mut v = Vec::new();
        ramp_steps(&RAMPS[0], &mut v);
        let top = v.iter().map(|b| b.max.y).fold(0.0, f32::max);
        assert!(top < 1.0 && top > 0.95);
        // Every step is shorter than a step-up.
        assert!(v.windows(2).all(|w| w[1].max.y - w[0].max.y < STEP_HEIGHT));
    }

    #[test]
    fn spawns_are_in_buy_zones() {
        for i in 0..5 {
            assert!(in_buy_zone(Team::T, spawn_point(Team::T, i)));
            assert!(in_buy_zone(Team::Ct, spawn_point(Team::Ct, i)));
        }
    }
}
