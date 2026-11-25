//! Hitscan against map geometry and player hitboxes.

use crate::constants::*;
use crate::map::raycast_map;
use crate::math::{Aabb, Vec3};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HitZone {
    Body,
    Head,
}

pub fn eye_position(feet: Vec3) -> Vec3 {
    Vec3::new(feet.x, feet.y + EYE_HEIGHT, feet.z)
}

pub fn body_hitbox(feet: Vec3) -> Aabb {
    Aabb::new(
        Vec3::new(feet.x - PLAYER_HALF_WIDTH, feet.y, feet.z - PLAYER_HALF_WIDTH),
        Vec3::new(
            feet.x + PLAYER_HALF_WIDTH,
            feet.y + HEAD_START,
            feet.z + PLAYER_HALF_WIDTH,
        ),
    )
}

pub fn head_hitbox(feet: Vec3) -> Aabb {
    Aabb::new(
        Vec3::new(
            feet.x - HEAD_HALF_WIDTH,
            feet.y + HEAD_START,
            feet.z - HEAD_HALF_WIDTH,
        ),
        Vec3::new(
            feet.x + HEAD_HALF_WIDTH,
            feet.y + PLAYER_HEIGHT,
            feet.z + HEAD_HALF_WIDTH,
        ),
    )
}

/// Ray vs one player. Head is tested first: it wins when both are hit at the
/// same distance.
pub fn ray_player(origin: Vec3, dir: Vec3, feet: Vec3, max_dist: f32) -> Option<(f32, HitZone)> {
    let head = head_hitbox(feet).ray_hit(origin, dir, max_dist);
    let body = body_hitbox(feet).ray_hit(origin, dir, max_dist);
    match (head, body) {
        (Some(h), Some(b)) if b < h => Some((b, HitZone::Body)),
        (Some(h), _) => Some((h, HitZone::Head)),
        (None, Some(b)) => Some((b, HitZone::Body)),
        (None, None) => None,
    }
}

pub struct ShotResult<Id> {
    pub end: Vec3,
    pub hit: Option<(Id, HitZone)>,
}

/// Trace a shot. `targets` yields (id, feet position) for every hittable
/// player (the caller filters out the shooter, the dead and teammates).
pub fn trace_shot<Id: Copy>(
    origin: Vec3,
    dir: Vec3,
    targets: impl Iterator<Item = (Id, Vec3)>,
) -> ShotResult<Id> {
    let wall = raycast_map(origin, dir, MAX_RANGE).unwrap_or(MAX_RANGE);
    let mut best: Option<(f32, Id, HitZone)> = None;
    for (id, feet) in targets {
        if let Some((d, zone)) = ray_player(origin, dir, feet, wall)
            && best.is_none_or(|(bd, _, _)| d < bd)
        {
            best = Some((d, id, zone));
        }
    }
    let dist = best.map_or(wall, |(d, _, _)| d);
    ShotResult {
        end: origin + dir * dist,
        hit: best.map(|(_, id, zone)| (id, zone)),
    }
}

pub fn damage_for(zone: HitZone) -> u8 {
    match zone {
        HitZone::Body => BODY_DAMAGE,
        HitZone::Head => HEAD_DAMAGE,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::view_dir;

    #[test]
    fn headshot_from_level_eye_height() {
        let origin = eye_position(Vec3::new(0.0, 0.0, 6.0));
        let dir = view_dir(0.0, 0.0);
        let r = trace_shot(origin, dir, [(7u32, Vec3::new(0.0, 0.0, 3.0))].into_iter());
        assert_eq!(r.hit, Some((7, HitZone::Head)));
    }

    #[test]
    fn walls_block_shots() {
        // Lane divider sits between x = -11 and -9.
        let origin = eye_position(Vec3::new(-5.0, 0.0, 10.0));
        let dir = Vec3::new(-1.0, 0.0, 0.0);
        let r = trace_shot(origin, dir, [(1u32, Vec3::new(-15.0, 0.0, 10.0))].into_iter());
        assert!(r.hit.is_none());
        assert!((r.end.x - -9.0).abs() < 1e-4);
    }
}
