// Other players, rendered ~100 ms in the past and interpolated between
// buffered snapshots so motion stays smooth despite network jitter.
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import * as THREE from 'three'
import { C } from '../wasm'
import { useHud } from '../game/store'
import { world } from '../game/world'
import { playerName } from '../net/session'
import type { PlayerId, PlayerSnap, Team } from '../net/protocol'
import { Mannequin, type Pose } from './Mannequin'

const INTERP_DELAY_MS = 100

type Sample = { x: number; y: number; z: number; yaw: number; pitch: number; snap: PlayerSnap }

const lerpAngle = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/** Interpolated state of a player at the current render time. */
function sample(id: PlayerId): Sample | null {
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
    x: pa.pos.x + (pb.pos.x - pa.pos.x) * t,
    y: pa.pos.y + (pb.pos.y - pa.pos.y) * t,
    z: pa.pos.z + (pb.pos.z - pa.pos.z) * t,
    yaw: lerpAngle(pa.yaw, pb.yaw, t),
    pitch: pa.pitch + (pb.pitch - pa.pitch) * t,
    snap: pb,
  }
}

function RemotePlayer({ id }: { id: PlayerId }) {
  const root = useRef<THREE.Group>(null)
  const label = useRef<HTMLDivElement>(null)
  const pose = useRef<Pose>({ speed: 0, pitch: 0, onGround: true, sliding: false })
  const [team, setTeam] = useState<Team | null>(null)
  const myTeam = useHud((s) => s.myTeam)
  const ffa = useHud((s) => s.room?.mode === 'Deathmatch')

  useFrame(() => {
    const s = sample(id)
    const g = root.current
    if (!g) return
    if (!s || !s.snap.alive) {
      g.visible = false
      return
    }
    g.visible = true
    g.position.set(s.x, s.y, s.z)
    g.rotation.y = s.yaw
    const v = s.snap.vel
    pose.current.speed = Math.hypot(v.x, v.z)
    pose.current.pitch = s.pitch
    pose.current.onGround = s.snap.on_ground
    pose.current.sliding = s.snap.slide > 0
    if (s.snap.team !== team) setTeam(s.snap.team)
    if (label.current) {
      label.current.textContent = playerName(id)
      label.current.style.display = !ffa && s.snap.team === myTeam ? 'block' : 'none'
    }
  })

  return (
    <group ref={root} visible={false}>
      <Mannequin look={ffa ? 'ffa' : team} pose={pose} />
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
