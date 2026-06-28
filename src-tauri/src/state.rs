use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;

/// Shared application state managed by Tauri. Commands pull the HTTP client, the
/// SQLite connection (behind a `Mutex`), the local proxy port, and the app data
/// dir (used for the library art cache) from here.
pub struct AppState {
    pub http: reqwest::Client,
    pub db: Mutex<Connection>,
    pub proxy_port: u16,
    pub app_data: PathBuf,
}
