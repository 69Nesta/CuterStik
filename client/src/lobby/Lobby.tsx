// Main menu: pick a name and side, then quick play, join a listed room or
// open your own. The room list polls the server's /api/rooms.
import { useEffect, useState, type FormEvent } from 'react'
import { useHud } from '../game/store'
import { startSession } from '../net/session'
import {
  MODES,
  hasTeams,
  modeName,
  teamName,
  type RoomRequest,
  type RoomSummary,
  type Team,
} from '../net/protocol'
import { LobbyStage } from './LobbyStage'

const POLL_MS = 2000

type RoomsState = { rooms: RoomSummary[]; error: boolean; loaded: boolean }

function useRooms(): RoomsState {
  const [state, setState] = useState<RoomsState>({ rooms: [], error: false, loaded: false })
  useEffect(() => {
    let alive = true
    let timer: number | undefined
    const poll = async () => {
      try {
        const res = await fetch('/api/rooms')
        if (!res.ok) throw new Error(String(res.status))
        const rooms = (await res.json()) as RoomSummary[]
        if (alive) setState({ rooms, error: false, loaded: true })
      } catch {
        if (alive) setState((s) => ({ ...s, error: true, loaded: true }))
      }
      if (alive) timer = window.setTimeout(poll, POLL_MS)
    }
    poll()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])
  return state
}

const SIDES: { value: Team | null; label: string }[] = [
  { value: 'T', label: 'Attackers' },
  { value: null, label: 'Auto' },
  { value: 'Ct', label: 'Defenders' },
]

function SidePicker() {
  const teamPref = useHud((s) => s.teamPref)
  return (
    <div className="side-picker" role="radiogroup" aria-label="Side">
      {SIDES.map((s) => (
        <button
          key={s.label}
          type="button"
          role="radio"
          aria-checked={teamPref === s.value}
          className={`side-option ${s.value === 'T' ? 'is-t' : s.value === 'Ct' ? 'is-ct' : 'is-auto'}`}
          onClick={() => {
            localStorage.setItem('teamPref', s.value ?? '')
            useHud.setState({ teamPref: s.value })
          }}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}

function ModePicker() {
  const modePref = useHud((s) => s.modePref)
  return (
    <div className="mode-picker" role="radiogroup" aria-label="Game mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={modePref === m.id}
          className="mode-option"
          onClick={() => {
            localStorage.setItem('modePref', m.id)
            useHud.setState({ modePref: m.id })
          }}
        >
          <strong>{m.name}</strong>
          <span>{m.blurb}</span>
        </button>
      ))}
    </div>
  )
}

function Pips({ filled, total }: { filled: number; total: number }) {
  return (
    <span className="pips" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < filled ? 'on' : ''} />
      ))}
    </span>
  )
}

function RoomRow({ room, onJoin, busy }: { room: RoomSummary; onJoin: () => void; busy: boolean }) {
  const full = room.players >= room.max_players
  return (
    <li className="room">
      <div className="room-main">
        <span className="room-name">
          {room.name}
          <span className={`mode-chip mode-${room.mode}`}>{modeName(room.mode)}</span>
        </span>
        <span className="room-state">
          {room.phase === 'Warmup' ? (
            'Warming up'
          ) : !hasTeams(room.mode) ? (
            `Leader on ${room.score_t} kills`
          ) : room.mode === 'TeamDeathmatch' ? (
            <>
              Kills <span className="team-t">{room.score_t}</span>
              {' – '}
              <span className="team-ct">{room.score_ct}</span>
            </>
          ) : (
            <>
              Round {room.round} · <span className="team-t">{room.score_t}</span>
              {' – '}
              <span className="team-ct">{room.score_ct}</span>
            </>
          )}
        </span>
      </div>
      <div className="room-count">
        <Pips filled={room.players} total={room.max_players} />
        <span>
          {room.players}/{room.max_players}
        </span>
      </div>
      <button className="btn btn-ink" disabled={full || busy} onClick={onJoin}>
        {full ? 'Full' : 'Join'}
      </button>
    </li>
  )
}

export function Lobby() {
  const { name: savedName, error, status, teamPref, modePref } = useHud()
  const [name, setName] = useState(savedName)
  const [roomName, setRoomName] = useState('')
  const { rooms, error: offline, loaded } = useRooms()
  const busy = status === 'connecting'

  const play = (room: RoomRequest) => startSession(name.trim(), room, teamPref)
  const create = (e: FormEvent) => {
    e.preventDefault()
    const fallback = `${name.trim() || 'Player'}'s room`
    play({ Create: { name: roomName.trim() || fallback, mode: modePref } })
  }

  return (
    <div className="lobby">
      <LobbyStage team={teamPref} />

      <header className="lobby-brand">
        <h1 className="logo">
          Cuter
          <br />
          Stik
        </h1>
        <p className="tagline">5v5 rounds. Attackers push, defenders hold.</p>
      </header>

      <section
        className={`lobby-loadout panel ${modePref === 'Deathmatch' ? 'no-sides' : ''}`}
        aria-label="Your player"
      >
        <label className="field">
          <span>Name</span>
          <input
            maxLength={16}
            placeholder="Player"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="field">
          <span>Side</span>
          <SidePicker />
        </div>
        <p className="hint">
          {modePref === 'Deathmatch'
            ? 'Deathmatch has no sides: everyone else is a target.'
            : teamPref
            ? `You'll join the ${teamName(teamPref)} if they aren't outnumbered.`
            : 'You go to whichever side needs a player.'}
        </p>
      </section>

      <section className="lobby-rooms panel" aria-label="Rooms">
        <ModePicker />

        <div className="rooms-head">
          <h2>Rooms</h2>
          <span className={`live-dot ${offline ? 'off' : ''}`}>
            {offline ? 'Server offline' : `${rooms.length} open`}
          </span>
        </div>

        <ul className="room-list">
          {rooms.map((r) => (
            <RoomRow key={r.id} room={r} busy={busy} onJoin={() => play({ Join: r.id })} />
          ))}
          {loaded && !rooms.length && (
            <li className="room-empty">
              {offline
                ? "Can't reach the game server. Start it with cargo run -p server."
                : 'No rooms open yet. Quick play opens one, or name your own below.'}
            </li>
          )}
        </ul>

        <form className="create-room" onSubmit={create}>
          <input
            maxLength={24}
            placeholder="Room name"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            aria-label="New room name"
          />
          <button className="btn btn-light" type="submit" disabled={busy}>
            Create {modeName(modePref)} room
          </button>
        </form>

        {error && <p className="error">{error}</p>}

        <button
          className="btn btn-primary btn-big"
          disabled={busy}
          onClick={() => play({ Quick: { mode: modePref } })}
        >
          {busy ? 'Connecting…' : `Play ${modeName(modePref)}`}
        </button>
      </section>
    </div>
  )
}
