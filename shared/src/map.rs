//! Static map geometry. This one list is the single source of truth: the
//! server collides against it and the client renders it (through wasm).

use serde::{Deserialize, Serialize};

use crate::math::{Aabb, Vec3};
use crate::protocol::Team;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Surface {
    Floor,
    Wall,
    Crate,
    Platform,
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
];

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
        Team::T => 0.0,                     // look toward -Z
        Team::Ct => core::f32::consts::PI, // look toward +Z
    }
}

/// Nearest distance at which a ray hits map geometry.
pub fn raycast_map(origin: Vec3, dir: Vec3, max_dist: f32) -> Option<f32> {
    MAP.iter()
        .filter_map(|m| m.bounds.ray_hit(origin, dir, max_dist))
        .min_by(f32::total_cmp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::movement::player_bounds;

    #[test]
    fn spawns_are_clear_of_geometry() {
        let all = T_SPAWNS.iter().chain(CT_SPAWNS).chain(DM_SPAWNS);
        for &p in all {
            let me = player_bounds(Vec3::new(p.x, p.y + 0.001, p.z));
            assert!(
                !MAP.iter().any(|m| me.overlaps(&m.bounds)),
                "spawn {p:?} is inside geometry"
            );
        }
    }
}
