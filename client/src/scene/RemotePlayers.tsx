// Other players, rendered ~100 ms in the past and interpolated between
// buffered snapshots so motion stays smooth despite network jitter.
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import * as THREE from 'three'
import { C } from '../wasm'
import { useHud } from '../game/store'
import { INTERP_DELAY_MS, world } from '../game/world'
import { playerName } from '../net/session'
import type { PlayerId, PlayerSnap, Team, WeaponId } from '../net/protocol'
import { sfx } from '../game/audio'
import { Mannequin, type Pose } from './Mannequin'

/** Meters between footsteps; below this speed players move silently. */
const STRIDE = 2.3
const QUIET_SPEED = 3.6

type Sample = { x: number; y: number; z: number; yaw: number; pitch: number; snap: PlayerSnap }

const lerpAngle = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/** Interpolated state of a player at the current render time. */
export function sample(id: PlayerId): Sample | null {
  const buf = world.buffer
  if (!buf.length || world.clockOffset === null) return null
  const renderMs = performance.now() - world.clockOffset - INTERP_DELAY_MS

  let i = buf.length - 1
  while (i > 0 && buf[i - 1].serverMs > renderMs) i--
  const b = buf[i]
  const a = i > 0 ? buf[i - 1] : b
  const pb = b.players.get(id)
  const pa = a.players.get(id) ?? pb
  if (!pa || !pb) return null

  // Don't interpolate across a respawn teleport.
  const span = b.serverMs - a.serverMs
  const t =
    span > 0 && pa.spawn_id === pb.spawn_id
      ? THREE.MathUtils.clamp((renderMs - a.serverMs) / span, 0, 1)
      : 1
  return {
    x: pa.mv.pos.x + (pb.mv.pos.x - pa.mv.pos.x) * t,
    y: pa.mv.pos.y + (pb.mv.pos.y - pa.mv.pos.y) * t,
    z: pa.mv.pos.z + (pb.mv.pos.z - pa.mv.pos.z) * t,
    yaw: lerpAngle(pa.yaw, pb.yaw, t),
    pitch: pa.pitch + (pb.pitch - pa.pitch) * t,
    snap: pb,
  }
}

function RemotePlayer({ id }: { id: PlayerId }) {
  const root = useRef<THREE.Group>(null)
  const label = useRef<HTMLDivElement>(null)
  const pose = useRef<Pose>({ speed: 0, pitch: 0, onGround: true, sliding: false, crouched: false })
  const [team, setTeam] = useState<Team | null>(null)
  const [weapon, setWeapon] = useState<WeaponId>('Rifle')
  const [bomb, setBomb] = useState(false)
  const steps = useRef({ dist: 0, x: 0, z: 0, wasGrounded: true, init: false })
  const myTeam = useHud((s) => s.myTeam)
  const ffa = useHud((s) => s.room?.mode === 'Deathmatch')

  useFrame(() => {
    const s = sample(id)
    const g = root.current
    if (!g) return
    if (!s || !s.snap.alive) {
      g.visible = false
      steps.current.init = false
      return
    }
    g.visible = true
    g.position.set(s.x, s.y, s.z)
    g.rotation.y = s.yaw
    const mv = s.snap.mv
    const speed = Math.hypot(mv.vel.x, mv.vel.z)
    pose.current.speed = speed
    pose.current.pitch = s.pitch
    pose.current.onGround = mv.on_ground
    pose.current.sliding = mv.slide > 0
    pose.current.crouched = mv.crouched
    if (s.snap.team !== team) setTeam(s.snap.team)
    if (s.snap.weapon !== weapon) setWeapon(s.snap.weapon)
    const b = world.latest?.bomb
    const carrying = typeof b === 'object' && 'Carried' in b && b.Carried.by === id
    if (carrying !== bomb) setBomb(carrying)

    // Footsteps: only running on the ground makes noise.
    const st = steps.current
    if (!st.init) Object.assign(st, { init: true, x: s.x, z: s.z, dist: 0, wasGrounded: mv.on_ground })
    const at = { x: s.x, y: s.y, z: s.z }
    if (mv.on_ground && !st.wasGrounded) sfx.land(at)
    st.wasGrounded = mv.on_ground
    if (mv.on_ground && speed >= QUIET_SPEED && !mv.crouched) {
      st.dist += Math.hypot(s.x - st.x, s.z - st.z)
      if (st.dist > STRIDE) {
        st.dist = 0
        sfx.footstep(at)
      }
    }
    st.x = s.x
    st.z = s.z
    if (label.current) {
      label.current.textContent = playerName(id)
      label.current.style.display = !ffa && s.snap.team === myTeam ? 'block' : 'none'
    }
  })

  return (
    <group ref={root} visible={false}>
      <Mannequin look={ffa ? 'ffa' : team} pose={pose} weapon={weapon} bomb={bomb} />
      <Html position={[0, C.player_height + 0.35, 0]} center zIndexRange={[10, 0]}>
        <div ref={label} className={`nameplate ${team === 'T' ? 'team-t' : 'team-ct'}`} />
      </Html>
    </group>
  )
}

export function RemotePlayers() {
  const ids = useHud((s) => s.remoteIds)
  return (
    <>
      {ids.map((id) => (
        <RemotePlayer key={id} id={id} />
      ))}
    </>
  )
}
