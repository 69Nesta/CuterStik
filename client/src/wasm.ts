// Loads the shared Rust crate (built by `npm run wasm`) and exposes typed
// views of its data. Call `loadWasm()` once before rendering.
import init, * as shared from './shared-wasm/shared.js'
import type {
  BombSite,
  BuyItem,
  BuyZone,
  Constants,
  MapBox,
  Ramp,
  RoomRequest,
  ServerMsg,
  Team,
  WeaponId,
  WeaponSpec,
} from './net/protocol'

export { LocalSim } from './shared-wasm/shared.js'

export let C: Constants
export let MAP: MapBox[]
export let RAMPS: Ramp[]
export let BOMB_SITES: BombSite[]
export let BUY_ZONES: BuyZone[]
export let WEAPONS: Record<WeaponId, WeaponSpec>

export async function loadWasm() {
  await init()
  C = shared.constants() as Constants
  MAP = shared.map_boxes() as MapBox[]
  RAMPS = shared.map_ramps() as Ramp[]
  BOMB_SITES = shared.bomb_sites() as BombSite[]
  BUY_ZONES = shared.buy_zones() as BuyZone[]
  const list = shared.weapons() as WeaponSpec[]
  WEAPONS = Object.fromEntries(list.map((w) => [w.id, w])) as Record<WeaponId, WeaponSpec>
}

export const encodeHello = (name: string, room: RoomRequest, team: Team | null) =>
  shared.encode_hello(name, room, team)
export const encodeBuy = (item: BuyItem) => shared.encode_buy(item)
export const decodeServer = (bytes: Uint8Array) => shared.decode_server(bytes) as ServerMsg
export const raycastMap = shared.raycast
