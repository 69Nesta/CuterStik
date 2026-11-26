import { useEffect, useRef, useState } from 'react'
import { C, WEAPONS } from '../wasm'
import { useHud } from '../game/store'
import { BUY_MENU, openBuyMenu } from '../game/input'
import { buy } from '../net/session'
import { CrosshairShape } from './Crosshair'
import { Minimap } from './Minimap'
import { PerfOverlay } from './PerfOverlay'
import { SettingsPanel } from './SettingsPanel'
import { world } from '../game/world'
import { stopSession } from '../net/session'
import { hasTeams, modeName, teamName, type BuyItem, type GameMode, type Team } from '../net/protocol'

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
  const { phase, timeLeft, round, scoreT, scoreCt, myKills, topKills, bomb } = useHud()
  const mode = useMode()
  const planted = bomb.kind === 'planted' && phase === 'Live'
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
    <div className={`clock ${planted ? 'bomb' : ''}`}>
      <div className="time">{phase === 'Warmup' ? '--:--' : formatTime(timeLeft)}</div>
      <div className="phase">{planted ? `Bomb planted at ${bomb.site}` : label}</div>
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
  const zoomed = useHud((s) => s.zoomed)
  const hitAt = useHud((s) => s.hitmarkerAt)
  const [hit, setHit] = useState(false)
  useEffect(() => {
    if (!hitAt) return
    setHit(true)
    const t = setTimeout(() => setHit(false), 150)
    return () => clearTimeout(t)
  }, [hitAt])
  // The scope has its own reticle.
  if (zoomed) return null
  return <CrosshairShape hit={hit} />
}

function Vitals() {
  const { health, armor, helmet, ammo, reserve, weapon, reloading, alive, myTeam, money } = useHud()
  const mode = useMode()
  if (!alive) return null
  return (
    <>
      <div className="vitals-left">
        {mode === 'Elimination' && <div className="money">${money}</div>}
        <div className="vitals-row">
          <div className={`vitals health ${health <= 25 ? 'low' : ''}`}>
            <span className="icon">✚</span>
            {health}
          </div>
          {armor > 0 && (
            <div className="vitals armor" title={helmet ? 'Kevlar + helmet' : 'Kevlar'}>
              <span className="icon">{helmet ? '⛑' : '⛨'}</span>
              {armor}
            </div>
          )}
        </div>
      </div>
      <div className="vitals ammo">
        <span className="weapon-name">{WEAPONS[weapon].name}</span>
        {reloading ? <span className="reloading">RELOADING</span> : ammo}
        <span className="mag">/ {reserve}</span>
      </div>
      <div className={`team-badge ${hasTeams(mode) ? teamClass(myTeam) : 'ffa'}`}>
        {hasTeams(mode) ? myTeam && teamName(myTeam) : 'Free for all'}
      </div>
    </>
  )
}

/** Plant / defuse prompts and progress. */
function BombStatus() {
  const { bomb, alive, phase, myTeam } = useHud()
  if (!alive || bomb.kind === 'none') return null
  let text: string | null = null
  let progress: number | null = null
  if (bomb.kind === 'carrying') {
    if (bomb.planting > 0) {
      text = 'Planting…'
      progress = bomb.planting
    } else {
      text = bomb.inSite && phase === 'Live' ? 'Hold E to plant' : 'You have the bomb: plant it at A or B'
    }
  } else if (bomb.kind === 'dropped') {
    text = 'The bomb is on the ground: pick it up'
  } else if (bomb.kind === 'planted') {
    if (bomb.defusingMe) {
      text = 'Defusing…'
      progress = bomb.defusing
    } else if (myTeam === 'Ct') {
      text = bomb.defusing > 0 ? 'A teammate is defusing' : `Defuse the bomb at ${bomb.site} (hold E)`
    }
  }
  if (!text) return null
  return (
    <div className="bomb-status">
      <span className="bomb-icon" aria-hidden>
        ●
      </span>
      {text}
      {progress !== null && (
        <div className="track">
          <div className="fill" style={{ transform: `scaleX(${Math.min(progress, 1)})` }} />
        </div>
      )}
    </div>
  )
}

function itemName(item: BuyItem) {
  if (item === 'Kevlar') return 'Kevlar'
  if (item === 'KevlarHelmet') return 'Kevlar + Helmet'
  return WEAPONS[item.Weapon].name
}

function itemPrice(item: BuyItem, armor: number, helmet: boolean) {
  if (item === 'Kevlar') return C.kevlar_price
  if (item === 'KevlarHelmet')
    return armor >= C.max_armor && !helmet ? C.kevlar_helmet_price - C.kevlar_price : C.kevlar_helmet_price
  return WEAPONS[item.Weapon].price
}

function BuyMenu() {
  const { buyOpen, canBuy, money, armor, helmet, room, phase } = useHud()
  const free = room?.mode !== 'Elimination' || phase === 'Warmup'
  useEffect(() => {
    if (buyOpen && !canBuy) openBuyMenu(false)
  }, [buyOpen, canBuy])
  if (!buyOpen) return null
  return (
    <div className="buy-menu" onClick={(e) => e.stopPropagation()}>
      <div className="card">
        <header>
          <h2>Buy</h2>
          <span className="money">{free ? 'Free loadout' : `$${money}`}</span>
        </header>
        <div className="buy-grid">
          {BUY_MENU.map(({ item, key }) => {
            const price = itemPrice(item, armor, helmet)
            const owned =
              (item === 'Kevlar' && armor >= C.max_armor) ||
              (item === 'KevlarHelmet' && armor >= C.max_armor && helmet)
            const afford = free || money >= price
            const spec = typeof item === 'object' ? WEAPONS[item.Weapon] : null
            return (
              <button key={key} className="buy-item" disabled={!afford || owned} onClick={() => buy(item)}>
                <kbd>{key}</kbd>
                <span className="name">{itemName(item)}</span>
                <span className="price">{free ? 'free' : `$${price}`}</span>
                {spec && (
                  <span className="stats">
                    {spec.mag} rounds · {Math.round(60 / spec.fire_interval)} rpm · {spec.body_damage} dmg
                    {spec.scoped_spread != null && ' · scope'}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <p className="hint">
          Number keys buy · <kbd>B</kbd> closes
        </p>
        <button className="play close" onClick={() => openBuyMenu(false)}>
          Back to the game
        </button>
      </div>
    </div>
  )
}

function ScopeOverlay() {
  const zoomed = useHud((s) => s.zoomed && s.alive)
  if (!zoomed) return null
  return (
    <div className="scope" aria-hidden>
      <i className="h" />
      <i className="v" />
    </div>
  )
}

function Killfeed() {
  const feed = useHud((s) => s.killfeed)
  return (
    <div className="killfeed">
      {feed.map((k) => (
        <div key={k.key} className="kill">
          <span className={teamClass(k.killerTeam)}>{k.killer}</span>
          <span className="weapon">
            {k.weapon ?? 'Bomb'}
            {k.headshot && ' ⌖'}
          </span>
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

/**
 * Grabs the mouse to resume play. Browsers refuse a new lock for about a
 * second after Esc released it, so a quick Play click retries once; the
 * click's user activation is still valid by then.
 */
function requestLock() {
  const canvas = document.querySelector<HTMLCanvasElement>('.game canvas')
  if (!canvas) return
  const retry = () => setTimeout(() => !document.pointerLockElement && canvas.requestPointerLock(), 1100)
  try {
    const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined
    p?.catch?.(retry)
  } catch {
    retry()
  }
}

function StatusOverlay() {
  const { alive, spawned, phase, locked, banner, room, settingsOpen, buyOpen } = useHud()
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
      {!locked && settingsOpen && (
        <SettingsPanel onClose={() => useHud.setState({ settingsOpen: false })} />
      )}
      {!locked && !settingsOpen && !buyOpen && (
        <div className="paused">
          <div className="card">
            {room && (
              <p className="room-label">
                {room.name}: {modeName(room.mode)}
              </p>
            )}
            <h2>Paused</h2>
            <p>
              <kbd>W A S D</kbd> move · <kbd>Space</kbd> jump · <kbd>Shift</kbd> sprint · <kbd>Alt</kbd> walk
              <br />
              <kbd>C</kbd> crouch (slide while running) · <kbd>E</kbd> plant / defuse
              <br />
              <kbd>Mouse</kbd> shoot · <kbd>Right</kbd> scope · <kbd>R</kbd> reload
              <br />
              <kbd>1</kbd> <kbd>2</kbd> <kbd>Q</kbd> weapons · <kbd>B</kbd> buy · <kbd>Tab</kbd> scores
            </p>
            <button className="play" autoFocus onClick={requestLock}>
              Play
            </button>
            <button onClick={() => useHud.setState({ settingsOpen: true })}>Settings</button>
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


function SlideMeter() {
  const alive = useHud((s) => s.alive)
  const fill = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const me = world.me
      if (fill.current && me) {
        // Fills back up while the slide is on cooldown.
        const ready = 1 - Math.min(me.mv.slide_cooldown / C.slide_cooldown, 1)
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

export function GameHud() {
  return (
    <div className="hud">
      <TopBar />
      <Minimap />
      <ScopeOverlay />
      <Crosshair />
      <Vitals />
      <BombStatus />
      <SlideMeter />
      <Killfeed />
      <Scoreboard />
      <StatusOverlay />
      <BuyMenu />
      <PerfOverlay />
    </div>
  )
}
