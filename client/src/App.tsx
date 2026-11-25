import { useHud } from './game/store'
import { GameHud } from './hud/Hud'
import { Lobby } from './lobby/Lobby'
import { GameCanvas } from './scene/GameCanvas'

export function App() {
  const status = useHud((s) => s.status)
  if (status !== 'playing') return <Lobby />
  return (
    <div className="game">
      <GameCanvas />
      <GameHud />
    </div>
  )
}
