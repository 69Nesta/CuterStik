// Map callouts that aren't part of collision: shared by the 3D scene
// (painted floor marks) and the minimap.

/** Bomb-site marks: label, center x/z, radius in meters, painted rotation. */
export const SITES = [
  { label: 'A', x: -21, z: -15, r: 2.4, yaw: 0.2 },
  { label: 'B', x: 19, z: -13, r: 2.4, yaw: -0.25 },
] as const

/** Spawn areas: attackers south (+Z), defenders north (-Z). */
export const SPAWN_ZONES = [
  { team: 'T', x: 0, z: 26.5 },
  { team: 'Ct', x: 0, z: -26.5 },
] as const
