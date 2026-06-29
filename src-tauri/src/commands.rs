//! Tauri command surface. Names and argument casing match the TS client in
//! `src/api/client.ts` (Tauri maps JS camelCase args to snake_case params).

use tauri::State;

use crate::catalog::{self, Catalog};
use crate::db::{
    self, Favorite, FavoriteInput, Recent, RecentInput, Settings, SettingsPatch, YtHidden,
    YtHideInput,
};
use crate::radio::{self, RadioFacets, RadioSearchParams, Station};
use crate::state::AppState;
use crate::youtube::{self, PlaylistInfo, YoutubeResults};

const CATALOG_MAX_AGE_MS: i64 = 24 * 60 * 60 * 1000;

#[tauri::command]
pub fn proxy_base(state: State<'_, AppState>) -> String {
    format!("http://127.0.0.1:{}", state.proxy_port)
}

#[tauri::command]
pub async fn get_catalog(state: State<'_, AppState>, refresh: bool) -> Result<Catalog, String> {
    if !refresh {
        let cached = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            db::get_cached_catalog(&conn, CATALOG_MAX_AGE_MS).map_err(|e| e.to_string())?
        };
        if let Some(json) = cached {
            if let Ok(cat) = serde_json::from_str::<Catalog>(&json) {
                return Ok(cat);
            }
        }
    }

    let raw = catalog::fetch_raw(&state.http).await.map_err(|e| e.to_string())?;
    let cat = catalog::normalize(raw);
    let json = serde_json::to_string(&cat).map_err(|e| e.to_string())?;
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::store_catalog(&conn, &json).map_err(|e| e.to_string())?;
    }
    Ok(cat)
}

#[tauri::command]
pub async fn radio_search(
    state: State<'_, AppState>,
    params: RadioSearchParams,
) -> Result<Vec<Station>, String> {
    radio::search(&state.http, params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn radio_facets(state: State<'_, AppState>) -> Result<RadioFacets, String> {
    radio::facets(&state.http).await.map_err(|e| e.to_string())
}

fn youtube_key(state: &State<'_, AppState>) -> Result<String, String> {
    let key = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_settings(&conn).map_err(|e| e.to_string())?.youtube_api_key
    };
    match key {
        Some(k) if !k.is_empty() => Ok(k),
        _ => Err("no_key".to_string()),
    }
}

#[tauri::command]
pub async fn youtube_search(
    state: State<'_, AppState>,
    q: String,
    page_token: Option<String>,
) -> Result<YoutubeResults, String> {
    let key = youtube_key(&state)?;
    youtube::search(&state.http, &key, &q, page_token.as_deref()).await
}

#[tauri::command]
pub async fn youtube_playlist(
    state: State<'_, AppState>,
    playlist_id: String,
    page_token: Option<String>,
) -> Result<YoutubeResults, String> {
    let key = youtube_key(&state)?;
    // No explicit page → return the WHOLE playlist (follows pagination past the
    // API's 50-item page cap). An explicit token still fetches a single page.
    match page_token.as_deref() {
        Some(pt) if !pt.is_empty() => {
            youtube::playlist(&state.http, &key, &playlist_id, Some(pt)).await
        }
        _ => youtube::playlist_all(&state.http, &key, &playlist_id).await,
    }
}

#[tauri::command]
pub async fn youtube_video(
    state: State<'_, AppState>,
    video_id: String,
) -> Result<YoutubeResults, String> {
    let key = youtube_key(&state)?;
    youtube::video(&state.http, &key, &video_id).await
}

#[tauri::command]
pub async fn youtube_playlist_info(
    state: State<'_, AppState>,
    playlist_id: String,
) -> Result<PlaylistInfo, String> {
    let key = youtube_key(&state)?;
    youtube::playlist_info(&state.http, &key, &playlist_id).await
}

#[tauri::command]
pub fn favorites_list(state: State<'_, AppState>) -> Result<Vec<Favorite>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_favorites(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn favorites_add(state: State<'_, AppState>, fav: FavoriteInput) -> Result<Favorite, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::add_favorite(&conn, fav).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn favorites_remove(
    state: State<'_, AppState>,
    source: String,
    ref_id: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::remove_favorite(&conn, &source, &ref_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn recents_list(state: State<'_, AppState>, limit: u32) -> Result<Vec<Recent>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_recents(&conn, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn recents_add(state: State<'_, AppState>, rec: RecentInput) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::add_recent(&conn, rec).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Result<Settings, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_settings(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, patch: SettingsPatch) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_settings(&conn, patch).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn yt_hide(state: State<'_, AppState>, playlist_id: String, v: YtHideInput) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::yt_hide(&conn, &playlist_id, v).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn yt_ban(state: State<'_, AppState>, v: YtHideInput) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::yt_ban(&conn, v).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn yt_restore(state: State<'_, AppState>, playlist_id: String, video_id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::yt_restore(&conn, &playlist_id, &video_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn yt_unban(state: State<'_, AppState>, video_id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::yt_unban(&conn, &video_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn yt_hidden_for_playlist(state: State<'_, AppState>, playlist_id: String) -> Result<Vec<YtHidden>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::yt_hidden_for_playlist(&conn, &playlist_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn yt_bans(state: State<'_, AppState>) -> Result<Vec<YtHidden>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::yt_bans(&conn).map_err(|e| e.to_string())
}

use crate::library::{
    self, AlbumInfo, ArtistCount, GenreCount, LibFolder, Playlist, ScanResult, Track,
};
use std::path::Path;
use tauri::Manager;

fn art_dir(state: &State<'_, AppState>) -> std::path::PathBuf {
    state.app_data.join("art")
}

#[tauri::command]
pub fn library_folders(state: State<'_, AppState>) -> Result<Vec<LibFolder>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    library::list_folders(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_add_folder(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<LibFolder, String> {
    // Best-effort widen the asset scope to this dir (static "**" already covers it).
    let _ = app.asset_protocol_scope().allow_directory(Path::new(&path), true);
    let folder = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let f = library::add_folder(&conn, &path).map_err(|e| e.to_string())?;
        library::rescan(&conn, Some(f.id), &art_dir(&state)).map_err(|e| e.to_string())?;
        f
    };
    Ok(folder)
}

#[tauri::command]
pub fn library_remove_folder(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    library::remove_folder(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_rescan(state: State<'_, AppState>, folder_id: Option<i64>) -> Result<ScanResult, String> {
    let dir = art_dir(&state);
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    library::rescan(&conn, folder_id, &dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_tracks(
    state: State<'_, AppState>,
    view: String,
    value: Option<String>,
) -> Result<Vec<Track>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    library::list_tracks(&conn, &view, value.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_artists(state: State<'_, AppState>) -> Result<Vec<ArtistCount>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    library::list_artists(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_albums(state: State<'_, AppState>) -> Result<Vec<AlbumInfo>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    library::list_albums(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_genres(state: State<'_, AppState>) -> Result<Vec<GenreCount>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    library::list_genres(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_playlists(state: State<'_, AppState>) -> Result<Vec<Playlist>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    library::list_playlists(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn playlist_create(state: State<'_, AppState>, name: String) -> Result<Playlist, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    library::playlist_create(&conn, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn playlist_rename(state: State<'_, AppState>, id: i64, name: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    library::playlist_rename(&conn, id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn playlist_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    library::playlist_delete(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn playlist_add(state: State<'_, AppState>, playlist_id: i64, track_id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    library::playlist_add(&conn, playlist_id, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn playlist_remove(state: State<'_, AppState>, playlist_id: i64, track_id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    library::playlist_remove(&conn, playlist_id, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn playlist_reorder(state: State<'_, AppState>, playlist_id: i64, track_ids: Vec<i64>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    library::playlist_reorder(&conn, playlist_id, &track_ids).map_err(|e| e.to_string())
}
