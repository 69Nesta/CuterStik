import { Canvas } from '@react-three/fiber'
import { Effects } from './Effects'
import { GameMap } from './GameMap'
import { LocalPlayer } from './LocalPlayer'
import { RemotePlayers } from './RemotePlayers'
import { ViewModel } from './ViewModel'

export function GameCanvas() {
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ fov: 80, near: 0.05, far: 300, position: [0, 20, 30] }}
      gl={{ powerPreference: 'high-performance', antialias: true }}
      onPointerDown={(e) => {
        const canvas = e.currentTarget.querySelector('canvas')
        if (!document.pointerLockElement) canvas?.requestPointerLock()
      }}
    >
      <color attach="background" args={['#8fd3ff']} />
      <fog attach="fog" args={['#bfe6ff', 45, 150]} />
      <hemisphereLight args={['#eaf6ff', '#8a93a6', 1.5]} />
      <directionalLight
        position={[25, 40, 15]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-far={120}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />
      <GameMap />
      <RemotePlayers />
      <Effects />
      <LocalPlayer />
      <ViewModel />
    </Canvas>
  )
}
