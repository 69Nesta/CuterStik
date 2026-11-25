// Loads the shared Rust crate (built by `npm run wasm`) and exposes typed
// views of its data. Call `loadWasm()` once before rendering.
import init, * as shared from './shared-wasm/shared.js'
import type { Constants, MapBox, RoomRequest, ServerMsg, Team } from './net/protocol'

export { LocalSim } from './shared-wasm/shared.js'

export let C: Constants
export let MAP: MapBox[]

export async function loadWasm() {
  await init()
  C = shared.constants() as Constants
  MAP = shared.map_boxes() as MapBox[]
}

export const encodeHello = (name: string, room: RoomRequest, team: Team | null) =>
  shared.encode_hello(name, room, team)
export const decodeServer = (bytes: Uint8Array) => shared.decode_server(bytes) as ServerMsg
export const raycastMap = shared.raycast
