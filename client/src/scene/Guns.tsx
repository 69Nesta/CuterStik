// Blocky weapon models, built from boxes. The barrel points down -Z and the
// origin sits at the grip, so the same model works in first person and in a
// character's hands. `muzzle` is where the flash goes.
import * as THREE from 'three'
import type { WeaponId } from '../net/protocol'
import type { CharacterMaterials } from './materials'

type Part = {
  pos: [number, number, number]
  size: [number, number, number]
  /** body = dark metal, grip = darker, accent = team color, stock = team armor color */
  mat: 'body' | 'grip' | 'accent' | 'stock' | 'lens'
  rotX?: number
}

type GunDef = { parts: Part[]; muzzle: [number, number, number] }

export const GUNS: Record<WeaponId, GunDef> = {
  Pistol: {
    parts: [
      { pos: [0, 0.03, -0.08], size: [0.045, 0.06, 0.2], mat: 'body' },
      { pos: [0, -0.04, 0.0], size: [0.04, 0.1, 0.055], mat: 'grip', rotX: 0.2 },
      { pos: [0, 0.035, -0.19], size: [0.03, 0.03, 0.03], mat: 'accent' },
    ],
    muzzle: [0, 0.035, -0.22],
  },
  HandCannon: {
    parts: [
      { pos: [0, 0.04, -0.11], size: [0.055, 0.075, 0.28], mat: 'body' },
      { pos: [0, 0.015, -0.12], size: [0.065, 0.05, 0.08], mat: 'stock' },
      { pos: [0, -0.05, 0.0], size: [0.048, 0.12, 0.065], mat: 'grip', rotX: 0.25 },
      { pos: [0, 0.085, -0.04], size: [0.012, 0.02, 0.03], mat: 'accent' },
    ],
    muzzle: [0, 0.04, -0.27],
  },
  Smg: {
    parts: [
      { pos: [0, 0.0, -0.08], size: [0.06, 0.09, 0.34], mat: 'body' },
      { pos: [0, -0.1, -0.12], size: [0.035, 0.16, 0.045], mat: 'grip' },
      { pos: [0, -0.08, 0.0], size: [0.04, 0.11, 0.06], mat: 'grip', rotX: 0.25 },
      { pos: [0, -0.01, 0.15], size: [0.03, 0.05, 0.16], mat: 'stock' },
      { pos: [0, 0.0, -0.27], size: [0.035, 0.035, 0.06], mat: 'accent' },
    ],
    muzzle: [0, 0.0, -0.31],
  },
  Rifle: {
    parts: [
      { pos: [0, 0, -0.1], size: [0.06, 0.09, 0.55], mat: 'body' },
      { pos: [0, 0, -0.44], size: [0.028, 0.028, 0.16], mat: 'grip' },
      { pos: [0, 0.003, -0.53], size: [0.04, 0.04, 0.06], mat: 'accent' },
      { pos: [0, -0.09, -0.05], size: [0.045, 0.14, 0.07], mat: 'grip', rotX: 0.25 },
      { pos: [0, -0.08, 0.17], size: [0.055, 0.12, 0.2], mat: 'stock' },
      { pos: [0, 0.07, -0.05], size: [0.02, 0.04, 0.12], mat: 'grip' },
    ],
    muzzle: [0, 0, -0.62],
  },
  Sniper: {
    parts: [
      { pos: [0, 0, -0.18], size: [0.055, 0.08, 0.72], mat: 'body' },
      { pos: [0, 0.005, -0.66], size: [0.025, 0.025, 0.24], mat: 'grip' },
      { pos: [0, 0.09, -0.12], size: [0.05, 0.05, 0.3], mat: 'grip' },
      { pos: [0, 0.09, -0.275], size: [0.044, 0.044, 0.01], mat: 'lens' },
      { pos: [0, -0.09, -0.02], size: [0.045, 0.14, 0.07], mat: 'grip', rotX: 0.25 },
      { pos: [0, -0.07, 0.22], size: [0.06, 0.14, 0.24], mat: 'stock' },
      { pos: [0, 0.003, -0.79], size: [0.04, 0.04, 0.05], mat: 'accent' },
    ],
    muzzle: [0, 0, -0.84],
  },
}

const grip = new THREE.MeshStandardMaterial({ color: '#262a32', roughness: 0.5 })
const lens = new THREE.MeshStandardMaterial({ color: '#7fd8ff', emissive: '#1b6f9a', roughness: 0.1 })

export function GunModel({
  weapon,
  m,
  shadows = false,
}: {
  weapon: WeaponId
  m: CharacterMaterials
  shadows?: boolean
}) {
  const mats = { body: m.gun, grip, accent: m.gunAccent, stock: m.body, lens }
  return (
    <group>
      {GUNS[weapon].parts.map((p, i) => (
        <mesh
          key={i}
          position={p.pos}
          rotation-x={p.rotX ?? 0}
          material={mats[p.mat]}
          castShadow={shadows}
        >
          <boxGeometry args={p.size} />
        </mesh>
      ))}
    </group>
  )
}
