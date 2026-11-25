//! Code shared by the server (native) and the client (wasm): constants,
//! map, movement, hitscan and the wire protocol.

extern crate alloc;

pub mod combat;
pub mod constants;
pub mod map;
pub mod math;
pub mod movement;
pub mod protocol;

#[cfg(feature = "wasm")]
mod wasm;
