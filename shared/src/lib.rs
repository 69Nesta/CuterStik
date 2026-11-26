//! Code shared by the server (native) and the client (wasm): constants,
//! map, movement, weapons, hitscan and the wire protocol.

extern crate alloc;

pub mod combat;
pub mod constants;
pub mod map;
pub mod math;
pub mod movement;
pub mod protocol;
pub mod weapons;

#[cfg(feature = "wasm")]
mod wasm;
