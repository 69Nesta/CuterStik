import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { Bomb } from './Bomb'
import { Effects } from './Effects'
import { GameMap } from './GameMap'
import { LocalPlayer } from './LocalPlayer'
import { LIGHTING } from './materials'
import { RemotePlayers } from './RemotePlayers'
import { Sky } from './Sky'
import { ViewModel } from './ViewModel'
import { QUALITY_DPR, useSettings } from '../game/settings'

/** Late-afternoon sun from the south-west: long, readable shadows. */
const SUN: [number, number, number] = [-28, 38, 22]

export function GameCanvas() {
  const quality = useSettings((s) => s.quality)
  const shadows = useSettings((s) => s.shadows)
  return (
    <Canvas
      // Toggling shadows needs every material recompiled: remount the scene.
      key={shadows ? 'shadows' : 'flat'}
      shadows={shadows ? 'percentage' : false}
      dpr={QUALITY_DPR[quality]}
      camera={{ fov: 80, near: 0.05, far: 300, position: [0, 20, 30] }}
      gl={{
        powerPreference: 'high-performance',
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
      onPointerDown={(e) => {
        const canvas = e.currentTarget.querySelector('canvas')
        if (!document.pointerLockElement) canvas?.requestPointerLock()
      }}
    >
      <Sky sunDirection={SUN} />
      <fog attach="fog" args={[LIGHTING.horizon, 50, 170]} />
      {/* Cool sky fill from above, warm bounce from the stone below. */}
      <hemisphereLight args={[LIGHTING.sky, LIGHTING.ground, 1.15]} />
      <directionalLight
        position={SUN}
        color={LIGHTING.sun}
        intensity={3.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-camera-far={140}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={4}
      />
      <GameMap />
      <RemotePlayers />
      <Bomb />
      <Effects />
      <LocalPlayer />
      <ViewModel />
    </Canvas>
  )
}
