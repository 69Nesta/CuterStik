use core::ops::{Add, AddAssign, Mul, Sub};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub const ZERO: Self = Self::new(0.0, 0.0, 0.0);

    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    pub fn dot(self, o: Self) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }

    pub fn length(self) -> f32 {
        libm::sqrtf(self.dot(self))
    }

    pub fn get(self, axis: usize) -> f32 {
        match axis {
            0 => self.x,
            1 => self.y,
            _ => self.z,
        }
    }

    pub fn set(&mut self, axis: usize, v: f32) {
        match axis {
            0 => self.x = v,
            1 => self.y = v,
            _ => self.z = v,
        }
    }
}

impl Add for Vec3 {
    type Output = Self;
    fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
}

impl AddAssign for Vec3 {
    fn add_assign(&mut self, o: Self) {
        *self = *self + o;
    }
}

impl Sub for Vec3 {
    type Output = Self;
    fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
}

impl Mul<f32> for Vec3 {
    type Output = Self;
    fn mul(self, s: f32) -> Self {
        Self::new(self.x * s, self.y * s, self.z * s)
    }
}

/// Axis-aligned box.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Aabb {
    pub min: Vec3,
    pub max: Vec3,
}

impl Aabb {
    pub const fn new(min: Vec3, max: Vec3) -> Self {
        Self { min, max }
    }

    /// Strict overlap: touching faces do not count, so a player resting
    /// exactly on a floor is not "inside" it.
    pub fn overlaps(&self, o: &Aabb) -> bool {
        self.min.x < o.max.x
            && self.max.x > o.min.x
            && self.min.y < o.max.y
            && self.max.y > o.min.y
            && self.min.z < o.max.z
            && self.max.z > o.min.z
    }

    /// Slab ray test. Returns the entry distance along `dir` (unit vector).
    pub fn ray_hit(&self, origin: Vec3, dir: Vec3, max_dist: f32) -> Option<f32> {
        let mut t_min = 0.0f32;
        let mut t_max = max_dist;
        for axis in 0..3 {
            let o = origin.get(axis);
            let d = dir.get(axis);
            let (lo, hi) = (self.min.get(axis), self.max.get(axis));
            if d.abs() < 1e-8 {
                if o < lo || o > hi {
                    return None;
                }
            } else {
                let inv = 1.0 / d;
                let mut t1 = (lo - o) * inv;
                let mut t2 = (hi - o) * inv;
                if t1 > t2 {
                    core::mem::swap(&mut t1, &mut t2);
                }
                t_min = t_min.max(t1);
                t_max = t_max.min(t2);
                if t_min > t_max {
                    return None;
                }
            }
        }
        Some(t_min)
    }
}

/// View direction for a yaw/pitch pair, matching a three.js camera with
/// Euler order "YXZ" (yaw 0 looks down -Z).
pub fn view_dir(yaw: f32, pitch: f32) -> Vec3 {
    let cp = libm::cosf(pitch);
    Vec3::new(-libm::sinf(yaw) * cp, libm::sinf(pitch), -libm::cosf(yaw) * cp)
}
