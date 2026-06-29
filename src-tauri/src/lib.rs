mod audio_edit;
mod catalog;
mod commands;
mod db;
mod library;
mod proxy;
mod radio;
mod state;
mod youtube;

#[cfg(feature = "downloader")]
mod downloader;

use std::sync::Mutex;

use tauri::Manager;

use state::AppState;

/// Bind a free loopback TCP port strictly above 20000 for the in-process proxy
/// (which also serves the YouTube player host page). Picks a pseudo-random
/// start so repeated launches don't predictably collide with other local apps,
/// probes with a real bind, and falls back to an OS-assigned port if the whole
/// range is somehow taken.
fn bind_proxy_listener() -> std::io::Result<std::net::TcpListener> {
    use std::time::{SystemTime, UNIX_EPOCH};
    const MIN: u32 = 20001;
    const MAX: u32 = 60000;
    let span = MAX - MIN;
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    for i in 0..span {
        let port = MIN + ((seed + i) % span);
        if let Ok(l) = std::net::TcpListener::bind(("127.0.0.1", port as u16)) {
            return Ok(l);
        }
    }
    std::net::TcpListener::bind("127.0.0.1:0")
}

/// Tauri entry point. Sets up the shared HTTP client, the SQLite database in
/// the app data dir, and the local media proxy on a free loopback port (>20000).
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(feature = "downloader")]
    {
        builder = builder.plugin(downloader::init());
    }

    builder
        .setup(|app| {
            // Shared HTTP client with a real desktop UA and transparent
            // gzip/brotli decompression.
            let http = reqwest::Client::builder()
                .user_agent(proxy::DEFAULT_UA)
                .connect_timeout(std::time::Duration::from_secs(12))
                .gzip(true)
                .brotli(true)
                .build()?;

            // SQLite database under the platform app data dir.
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("boxcast.sqlite");
            let conn = rusqlite::Connection::open(&db_path)?;
            db::init(&conn)?;
            library::init(&conn)?;

            // Bind the media proxy to an OS-assigned (guaranteed-free) port on
            // loopback, then hand the listener to axum on the async runtime.
            let std_listener = bind_proxy_listener()?;
            let proxy_port = std_listener.local_addr()?.port();
            std_listener.set_nonblocking(true)?;
            let proxy_client = http.clone();
            tauri::async_runtime::spawn(async move {
                let listener = tokio::net::TcpListener::from_std(std_listener)?;
                axum::serve(listener, proxy::router(proxy_client).into_make_service()).await?;
                Ok::<(), anyhow::Error>(())
            });

            app.manage(AppState {
                http,
                db: Mutex::new(conn),
                proxy_port,
                app_data: data_dir.clone(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::proxy_base,
            commands::get_catalog,
            commands::radio_search,
            commands::radio_facets,
            commands::youtube_search,
            commands::youtube_playlist,
            commands::youtube_video,
            commands::youtube_playlist_info,
            commands::favorites_list,
            commands::favorites_add,
            commands::favorites_remove,
            commands::recents_list,
            commands::recents_add,
            commands::settings_get,
            commands::settings_set,
            commands::yt_hide,
            commands::yt_ban,
            commands::yt_restore,
            commands::yt_unban,
            commands::yt_hidden_for_playlist,
            commands::yt_bans,
            commands::library_folders,
            commands::library_add_folder,
            commands::library_remove_folder,
            commands::library_rescan,
            commands::library_tracks,
            commands::library_artists,
            commands::library_albums,
            commands::library_genres,
            commands::library_playlists,
            commands::playlist_create,
            commands::playlist_rename,
            commands::playlist_delete,
            commands::playlist_add,
            commands::playlist_remove,
            commands::playlist_reorder,
            audio_edit::mp3_probe,
            audio_edit::mp3_cut,
            audio_edit::track_trash,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
