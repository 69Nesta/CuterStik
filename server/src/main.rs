mod net;
mod room;
mod rooms;

use std::net::SocketAddr;

use axum::{Router, routing::get};
use tower_http::services::{ServeDir, ServeFile};
use tracing_subscriber::EnvFilter;

use crate::rooms::RoomManager;

#[derive(Clone)]
pub struct AppState {
    pub rooms: RoomManager,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("server=info")),
        )
        .init();

    let state = AppState {
        rooms: RoomManager::default(),
    };

    let mut app = Router::new()
        .route("/ws", get(net::ws_handler))
        .route("/api/rooms", get(rooms::list_rooms))
        .route("/health", get(|| async { "ok" }))
        .with_state(state);

    // In production, serve the built client from the same origin.
    if let Ok(dir) = std::env::var("STATIC_DIR") {
        let index = format!("{dir}/index.html");
        app = app.fallback_service(ServeDir::new(&dir).fallback(ServeFile::new(index)));
        tracing::info!("serving static files from {dir}");
    }

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("cannot bind {addr}: {e}"));
    tracing::info!("listening on http://{addr} (ws at /ws)");

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("server error");
}
