import { useEffect, useRef, useState } from 'react'
import { C } from '../wasm'
import { useHud } from '../game/store'
import { world } from '../game/world'
import { stopSession } from '../net/session'
import { hasTeams, modeName, teamName, type GameMode, type Team } from '../net/protocol'

const teamClass = (t?: Team | null) => (t === 'T' ? 'team-t' : t === 'Ct' ? 'team-ct' : '')

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

const useMode = (): GameMode => useHud((s) => s.room?.mode ?? 'Elimination')

function goalText(mode: GameMode) {
  if (mode === 'Elimination') return `First to ${C.rounds_to_win} rounds`
  if (mode === 'TeamDeathmatch') return `First to ${C.tdm_kill_limit} kills`
  return `First to ${C.dm_kill_limit} kills`
}

function TopBar() {
  const { phase, timeLeft, round, scoreT, scoreCt, myKills, topKills } = useHud()
  const mode = useMode()
  const label =
    phase === 'Warmup'
      ? mode === 'Deathmatch'
        ? 'Warmup: waiting for a 2nd player'
        : 'Warmup: waiting for both teams'
      : phase === 'Freeze'
        ? 'Get ready'
        : phase === 'RoundEnd'
          ? 'Round over'
          : phase === 'MatchEnd'
            ? 'Match over'
            : mode === 'Elimination'
              ? `Round ${round}`
              : goalText(mode)
  const clock = (
    <div className="clock">
      <div className="time">{phase === 'Warmup' ? '--:--' : formatTime(timeLeft)}</div>
      <div className="phase">{label}</div>
    </div>
  )
  if (!hasTeams(mode)) {
    // Free-for-all: your kills against the leader's.
    return (
      <div className="topbar">
        <div className="score you" title="Your kills">{myKills}</div>
        {clock}
        <div className="score lead" title="Leader's kills">{topKills}</div>
      </div>
    )
  }
  return (
    <div className="topbar">
      <div className="score team-t">{scoreT}</div>
      {clock}
      <div className="score team-ct">{scoreCt}</div>
    </div>
  )
}

function Crosshair() {
  const hitAt = useHud((s) => s.hitmarkerAt)
  const [hit, setHit] = useState(false)
  useEffect(() => {
    if (!hitAt) return
    setHit(true)
    const t = setTimeout(() => setHit(false), 150)
    return () => clearTimeout(t)
  }, [hitAt])
  return (
    <div className="crosshair">
      <i className="h l" />
      <i className="h r" />
      <i className="v t" />
      <i className="v b" />
      {hit && <div className="hitmarker" />}
    </div>
  )
}

function Vitals() {
  const { health, ammo, reloading, alive, myTeam } = useHud()
  const mode = useMode()
  if (!alive) return null
  return (
    <>
      <div className={`vitals health ${health <= 25 ? 'low' : ''}`}>
        <span className="icon">✚</span>
        {health}
      </div>
      <div className="vitals ammo">
        {reloading ? <span className="reloading">RELOADING</span> : ammo}
        <span className="mag">/ {C.mag_size}</span>
      </div>
      <div className={`team-badge ${hasTeams(mode) ? teamClass(myTeam) : 'ffa'}`}>
        {hasTeams(mode) ? myTeam && teamName(myTeam) : 'Free for all'}
      </div>
    </>
  )
}

function Killfeed() {
  const feed = useHud((s) => s.killfeed)
  return (
    <div className="killfeed">
      {feed.map((k) => (
        <div key={k.key} className="kill">
          <span className={teamClass(k.killerTeam)}>{k.killer}</span>
          <span className="weapon">{k.headshot ? '⌖ HS' : '▸'}</span>
          <span className={teamClass(k.victimTeam)}>{k.victim}</span>
        </div>
      ))}
    </div>
  )
}

function ScoreTable({ rows, myId }: { rows: ReturnType<typeof useHud.getState>['scoreboard']; myId: number | null }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Player</th>
          <th>K</th>
          <th>D</th>
        </tr>
      </thead>
      <tbody>
        {[...rows]
          .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
          .map((r) => (
            <tr key={r.id} className={`${r.id === myId ? 'me' : ''} ${r.alive ? '' : 'dead'}`}>
              <td>{r.name}</td>
              <td>{r.kills}</td>
              <td>{r.deaths}</td>
            </tr>
          ))}
      </tbody>
    </table>
  )
}

function Scoreboard() {
  const { showScores, scoreboard, myId, scoreT, scoreCt, phase, room } = useHud()
  const mode = useMode()
  // Scores stay up while a match result is on screen.
  if (!showScores && phase !== 'MatchEnd') return null
  if (!hasTeams(mode)) {
    return (
      <div className="scoreboard solo">
        <div className="side">
          <h2>
            {room?.name ?? modeName(mode)} <span>{goalText(mode)}</span>
          </h2>
          <ScoreTable rows={scoreboard} myId={myId} />
        </div>
      </div>
    )
  }
  const sides: Team[] = ['Ct', 'T']
  return (
    <div className="scoreboard">
      {sides.map((team) => (
        <div key={team} className={`side ${teamClass(team)}`}>
          <h2>
            {teamName(team)} <span>{team === 'T' ? scoreT : scoreCt}</span>
          </h2>
          <ScoreTable rows={scoreboard.filter((r) => r.team === team)} myId={myId} />
        </div>
      ))}
    </div>
  )
}

function requestLock() {
  document.querySelector<HTMLCanvasElement>('.game canvas')?.requestPointerLock()
}

function StatusOverlay() {
  const { alive, spawned, phase, locked, banner, room } = useHud()
  const mode = useMode()
  let msg: string | null = null
  if (!alive && phase !== 'MatchEnd') {
    msg =
      phase === 'Warmup' || mode !== 'Elimination'
        ? 'Respawning…'
        : spawned
          ? 'Out for this round. You spawn next round.'
          : 'Round in progress. You spawn next round.'
  }
  return (
    <>
      {banner && <div className="banner">{banner}</div>}
      {msg && <div className="status">{msg}</div>}
      {!locked && (
        <div className="paused" onClick={requestLock}>
          <div className="card">
            {room && (
              <p className="room-label">
                {room.name}: {modeName(room.mode)}
              </p>
            )}
            <h2>Click to play</h2>
            <p>
              <kbd>W A S D</kbd> move · <kbd>Space</kbd> jump · <kbd>Shift</kbd> sprint
              <br />
              <kbd>C</kbd> slide (while sprinting) · <kbd>Alt</kbd> walk
              <br />
              <kbd>Mouse</kbd> aim & shoot · <kbd>R</kbd> reload · <kbd>Tab</kbd> scores
            </p>
            <Settings />
            <button
              className="secondary"
              onClick={(e) => {
                e.stopPropagation()
                stopSession()
                useHud.setState({ status: 'menu', error: null })
              }}
            >
              Back to lobby
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function Settings() {
  const sensitivity = useHud((s) => s.sensitivity)
  return (
    <label className="setting" onClick={(e) => e.stopPropagation()}>
      Sensitivity
      <input
        type="range"
        min={0.5}
        max={6}
        step={0.1}
        value={sensitivity}
        onChange={(e) => {
          const v = Number(e.target.value)
          localStorage.setItem('sensitivity', String(v))
          useHud.setState({ sensitivity: v })
        }}
      />
      <span>{sensitivity.toFixed(1)}</span>
    </label>
  )
}

/** Fills back up while the slide is on cooldown. */
const SLIDE_COOLDOWN = 1.4 // keep in sync with shared/src/constants.rs

function SlideMeter() {
  const alive = useHud((s) => s.alive)
  const fill = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const me = world.me
      if (fill.current && me) {
        const ready = 1 - Math.min(me.slide_cooldown / SLIDE_COOLDOWN, 1)
        fill.current.style.transform = `scaleX(${ready})`
        fill.current.parentElement!.classList.toggle('ready', ready >= 1)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  if (!alive) return null
  return (
    <div className="slide-meter" aria-hidden>
      <span>Slide</span>
      <div className="track">
        <div ref={fill} className="fill" />
      </div>
    </div>
  )
}

function NetGraph() {
  const [text, setText] = useState('')
  useEffect(() => {
    const id = setInterval(() => {
      const sim = world.sim
      if (!sim) return
      setText(
        `speed ${sim.horizontal_speed().toFixed(2)} m/s · unacked ${sim.pending_count()} · tick ${world.latest?.tick ?? 0}`,
      )
    }, 250)
    return () => clearInterval(id)
  }, [])
  return <div className="netgraph">{text}</div>
}

export function GameHud() {
  return (
    <div className="hud">
      <TopBar />
      <Crosshair />
      <Vitals />
      <SlideMeter />
      <Killfeed />
      <Scoreboard />
      <StatusOverlay />
      <NetGraph />
    </div>
  )
}
