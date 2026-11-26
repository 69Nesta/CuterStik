//! Hitscan against map geometry and player hitboxes.

use crate::constants::*;
use crate::map::raycast_map;
use crate::math::{Aabb, Vec3, view_dir};
use crate::weapons::{WeaponId, WeaponSpec, spray_offset};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HitZone {
    Body,
    Head,
}

/// Head box height (the top of the player box).
const HEAD_SIZE: f32 = PLAYER_HEIGHT - HEAD_START;

pub fn eye_position(feet: Vec3) -> Vec3 {
    Vec3::new(feet.x, feet.y + EYE_HEIGHT, feet.z)
}

/// Body hitbox for a player of `height` (shorter while crouched).
pub fn body_hitbox(feet: Vec3, height: f32) -> Aabb {
    Aabb::new(
        Vec3::new(
            feet.x - PLAYER_HALF_WIDTH,
            feet.y,
            feet.z - PLAYER_HALF_WIDTH,
        ),
        Vec3::new(
            feet.x + PLAYER_HALF_WIDTH,
            feet.y + height - HEAD_SIZE,
            feet.z + PLAYER_HALF_WIDTH,
        ),
    )
}

pub fn head_hitbox(feet: Vec3, height: f32) -> Aabb {
    Aabb::new(
        Vec3::new(
            feet.x - HEAD_HALF_WIDTH,
            feet.y + height - HEAD_SIZE,
            feet.z - HEAD_HALF_WIDTH,
        ),
        Vec3::new(
            feet.x + HEAD_HALF_WIDTH,
            feet.y + height,
            feet.z + HEAD_HALF_WIDTH,
        ),
    )
}

/// Ray vs one player. Head is tested first: it wins when both are hit at the
/// same distance.
pub fn ray_player(
    origin: Vec3,
    dir: Vec3,
    feet: Vec3,
    height: f32,
    max_dist: f32,
) -> Option<(f32, HitZone)> {
    let head = head_hitbox(feet, height).ray_hit(origin, dir, max_dist);
    let body = body_hitbox(feet, height).ray_hit(origin, dir, max_dist);
    match (head, body) {
        (Some(h), Some(b)) if b < h => Some((b, HitZone::Body)),
        (Some(h), _) => Some((h, HitZone::Head)),
        (None, Some(b)) => Some((b, HitZone::Body)),
        (None, None) => None,
    }
}

/// A hittable player: id, feet position, box height.
#[derive(Debug, Clone, Copy)]
pub struct Target<Id> {
    pub id: Id,
    pub feet: Vec3,
    pub height: f32,
}

pub struct ShotResult<Id> {
    pub end: Vec3,
    pub hit: Option<(Id, HitZone)>,
}

/// Trace a shot. `targets` yields every hittable player (the caller filters
/// out the shooter, the dead and teammates).
pub fn trace_shot<Id: Copy>(
    origin: Vec3,
    dir: Vec3,
    targets: impl Iterator<Item = Target<Id>>,
) -> ShotResult<Id> {
    let wall = raycast_map(origin, dir, MAX_RANGE).unwrap_or(MAX_RANGE);
    let mut best: Option<(f32, Id, HitZone)> = None;
    for t in targets {
        if let Some((d, zone)) = ray_player(origin, dir, t.feet, t.height, wall)
            && best.is_none_or(|(bd, _, _)| d < bd)
        {
            best = Some((d, t.id, zone));
        }
    }
    let dist = best.map_or(wall, |(d, _, _)| d);
    ShotResult {
        end: origin + dir * dist,
        hit: best.map(|(_, id, zone)| (id, zone)),
    }
}

/// Deterministic per-shot random numbers in [0, 1), from the shooter and
/// the input seq that fired. Server and client get the same spread.
pub fn shot_random(shooter: u32, seq: u32) -> (f32, f32) {
    let mut z = ((shooter as u64) << 32 | seq as u64).wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    let a = (z >> 40) as f32 / (1u64 << 24) as f32;
    let b = ((z >> 16) & 0xFF_FFFF) as f32 / (1u64 << 24) as f32;
    (a, b)
}

/// Direction of a shot: the view direction, pushed by the recoil pattern
/// and a random offset inside the inaccuracy cone (biased to the center).
pub fn shot_direction(
    yaw: f32,
    pitch: f32,
    spec: &WeaponSpec,
    spray: f32,
    inaccuracy: f32,
    rand: (f32, f32),
) -> Vec3 {
    let (kick_pitch, kick_yaw) = spray_offset(spec, spray);
    let angle = rand.0 * core::f32::consts::TAU;
    let radius = inaccuracy * rand.1;
    view_dir(
        yaw + kick_yaw + libm::cosf(angle) * radius,
        pitch + kick_pitch + libm::sinf(angle) * radius,
    )
}

/// Health and armor lost to one hit. Armor soaks up the share of damage
/// the weapon doesn't penetrate; the head is only covered by a helmet.
pub fn apply_damage(
    damage: f32,
    armor_pen: f32,
    zone: HitZone,
    armor: u8,
    helmet: bool,
) -> (u8, u8) {
    let covered = armor > 0 && (zone == HitZone::Body || helmet);
    if !covered {
        return (round_damage(damage), 0);
    }
    let mut health = damage * armor_pen;
    let mut absorbed = damage - health;
    if absorbed > armor as f32 {
        health += absorbed - armor as f32;
        absorbed = armor as f32;
    }
    (round_damage(health), round_damage(absorbed))
}

fn round_damage(d: f32) -> u8 {
    libm::roundf(d).clamp(0.0, 255.0) as u8
}

pub fn weapon_damage(weapon: WeaponId, zone: HitZone) -> f32 {
    let s = weapon.spec();
    match zone {
        HitZone::Body => s.body_damage,
        HitZone::Head => s.head_damage,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn standing(id: u32, feet: Vec3) -> Target<u32> {
        Target {
            id,
            feet,
            height: PLAYER_HEIGHT,
        }
    }

    #[test]
    fn headshot_from_level_eye_height() {
        let origin = eye_position(Vec3::new(0.0, 0.0, 6.0));
        let dir = view_dir(0.0, 0.0);
        let r = trace_shot(
            origin,
            dir,
            [standing(7, Vec3::new(0.0, 0.0, 3.0))].into_iter(),
        );
        assert_eq!(r.hit, Some((7, HitZone::Head)));
    }

    #[test]
    fn walls_block_shots() {
        // Lane divider sits between x = -11 and -9.
        let origin = eye_position(Vec3::new(-5.0, 0.0, 10.0));
        let dir = Vec3::new(-1.0, 0.0, 0.0);
        let r = trace_shot(
            origin,
            dir,
            [standing(1, Vec3::new(-15.0, 0.0, 10.0))].into_iter(),
        );
        assert!(r.hit.is_none());
        assert!((r.end.x - -9.0).abs() < 1e-4);
    }

    #[test]
    fn crouching_ducks_under_a_head_level_shot() {
        let origin = eye_position(Vec3::new(0.0, 0.0, 6.0));
        let dir = view_dir(0.0, 0.0);
        let crouched = Target {
            id: 7u32,
            feet: Vec3::new(0.0, 0.0, 3.0),
            height: CROUCH_HEIGHT,
        };
        assert!(
            trace_shot(origin, dir, [crouched].into_iter())
                .hit
                .is_none()
        );
    }

    #[test]
    fn armor_soaks_body_damage_and_helmet_the_head() {
        assert_eq!(apply_damage(30.0, 0.5, HitZone::Body, 100, false), (15, 15));
        assert_eq!(
            apply_damage(100.0, 0.5, HitZone::Head, 100, false),
            (100, 0)
        );
        assert_eq!(apply_damage(100.0, 0.5, HitZone::Head, 100, true), (50, 50));
        // Thin armor only absorbs what's left of it.
        assert_eq!(apply_damage(100.0, 0.5, HitZone::Body, 10, false), (90, 10));
    }

    #[test]
    fn spread_is_deterministic_and_bounded() {
        let spec = WeaponId::Rifle.spec();
        let r = shot_random(3, 99);
        assert_eq!(r, shot_random(3, 99));
        assert_ne!(r, shot_random(3, 100));
        let d = shot_direction(0.0, 0.0, spec, 0.0, 0.01, r);
        let center = view_dir(0.0, 0.0);
        assert!(libm::acosf(d.dot(center).min(1.0)) <= 0.0101);
    }
}
