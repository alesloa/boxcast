//! SQLite persistence: settings, favorites, recents, and the catalog cache.

use std::time::{SystemTime, UNIX_EPOCH};

use rand::Rng;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, ref TEXT NOT NULL, name TEXT NOT NULL,
  logo TEXT, meta_json TEXT, created_at INTEGER NOT NULL, UNIQUE(source, ref));
CREATE TABLE IF NOT EXISTS recents (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, ref TEXT NOT NULL, name TEXT NOT NULL,
  logo TEXT, played_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS catalog_cache (key TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS yt_hidden (
  video_id      TEXT NOT NULL,
  playlist_id   TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL DEFAULT '',
  channel_title TEXT NOT NULL DEFAULT '',
  thumbnail     TEXT NOT NULL DEFAULT '',
  hidden_at     INTEGER NOT NULL,
  PRIMARY KEY (video_id, playlist_id)
);
"#;

const DEFAULT_VOLUME: f64 = 0.7;
const RECENTS_LIMIT: i64 = 50;

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA)
}

// ---------------------------------------------------------------------------
// Shapes (camelCase wire format; `ref` field uses the literal JSON key `ref`).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub id: String,
    pub source: String,
    #[serde(rename = "ref")]
    pub ref_: String,
    pub name: String,
    pub logo: Option<String>,
    pub meta_json: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteInput {
    pub source: String,
    #[serde(rename = "ref")]
    pub ref_: String,
    pub name: String,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub meta_json: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    pub id: String,
    pub source: String,
    #[serde(rename = "ref")]
    pub ref_: String,
    pub name: String,
    pub logo: Option<String>,
    pub played_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentInput {
    pub source: String,
    #[serde(rename = "ref")]
    pub ref_: String,
    pub name: String,
    #[serde(default)]
    pub logo: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub youtube_api_key: Option<String>,
    pub nsfw: bool,
    pub default_volume: f64,
}

/// Deserialize an optional-and-nullable field so we can tell "absent" (leave
/// unchanged) from "present as null" (clear it).
fn double_option<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::deserialize(d)?))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    #[serde(default, deserialize_with = "double_option")]
    pub youtube_api_key: Option<Option<String>>,
    #[serde(default)]
    pub nsfw: Option<bool>,
    #[serde(default)]
    pub default_volume: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtHidden {
    pub video_id: String,
    pub playlist_id: String,
    pub title: String,
    pub channel_title: String,
    pub thumbnail: String,
    pub hidden_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YtHideInput {
    pub video_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub channel_title: String,
    #[serde(default)]
    pub thumbnail: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Short, collision-resistant id like `fav_1a2b3c4d5e`.
fn gen_id(prefix: &str) -> String {
    let n: u64 = rand::thread_rng().gen();
    format!("{prefix}_{:010x}", n & 0xff_ffff_ffff)
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

fn read_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .optional()
}

fn write_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Generic durable key/value over the `settings` table. For app data that must
/// survive restarts but doesn't warrant its own schema (e.g. YouTube
/// collections). localStorage in the packaged webview only flushes on a clean
/// quit, so durable data lives here instead.
pub fn kv_get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    read_setting(conn, key)
}

pub fn kv_set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    write_setting(conn, key, value)
}

pub fn get_settings(conn: &Connection) -> rusqlite::Result<Settings> {
    let youtube_api_key = read_setting(conn, "youtube_api_key")?.filter(|s| !s.is_empty());
    let nsfw = read_setting(conn, "nsfw")?
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let default_volume = read_setting(conn, "default_volume")?
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(DEFAULT_VOLUME);
    Ok(Settings {
        youtube_api_key,
        nsfw,
        default_volume,
    })
}

pub fn set_settings(conn: &Connection, patch: SettingsPatch) -> rusqlite::Result<()> {
    if let Some(opt) = patch.youtube_api_key {
        // None (cleared) is stored as empty string and read back as None.
        write_setting(conn, "youtube_api_key", &opt.unwrap_or_default())?;
    }
    if let Some(nsfw) = patch.nsfw {
        write_setting(conn, "nsfw", if nsfw { "1" } else { "0" })?;
    }
    if let Some(vol) = patch.default_volume {
        write_setting(conn, "default_volume", &vol.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

pub fn list_favorites(conn: &Connection) -> rusqlite::Result<Vec<Favorite>> {
    let mut stmt = conn.prepare(
        "SELECT id, source, ref, name, logo, meta_json, created_at
         FROM favorites ORDER BY created_at DESC, rowid DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Favorite {
            id: r.get(0)?,
            source: r.get(1)?,
            ref_: r.get(2)?,
            name: r.get(3)?,
            logo: r.get(4)?,
            meta_json: r.get(5)?,
            created_at: r.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn add_favorite(conn: &Connection, input: FavoriteInput) -> rusqlite::Result<Favorite> {
    let id = gen_id("fav");
    let now = now_millis();
    conn.execute(
        "INSERT INTO favorites (id, source, ref, name, logo, meta_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(source, ref) DO UPDATE SET
           name = excluded.name, logo = excluded.logo, meta_json = excluded.meta_json",
        params![id, input.source, input.ref_, input.name, input.logo, input.meta_json, now],
    )?;
    // Read the row back so the returned id/created_at reflect any prior insert.
    conn.query_row(
        "SELECT id, source, ref, name, logo, meta_json, created_at
         FROM favorites WHERE source = ?1 AND ref = ?2",
        params![input.source, input.ref_],
        |r| {
            Ok(Favorite {
                id: r.get(0)?,
                source: r.get(1)?,
                ref_: r.get(2)?,
                name: r.get(3)?,
                logo: r.get(4)?,
                meta_json: r.get(5)?,
                created_at: r.get(6)?,
            })
        },
    )
}

pub fn remove_favorite(conn: &Connection, source: &str, ref_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM favorites WHERE source = ?1 AND ref = ?2",
        params![source, ref_id],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// YouTube hidden / banned
// ---------------------------------------------------------------------------

fn upsert_hidden(conn: &Connection, playlist_id: &str, v: &YtHideInput) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO yt_hidden (video_id, playlist_id, title, channel_title, thumbnail, hidden_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(video_id, playlist_id) DO UPDATE SET
           title = excluded.title, channel_title = excluded.channel_title,
           thumbnail = excluded.thumbnail, hidden_at = excluded.hidden_at",
        params![v.video_id, playlist_id, v.title, v.channel_title, v.thumbnail, now_millis()],
    )?;
    Ok(())
}

fn list_hidden(conn: &Connection, playlist_id: &str) -> rusqlite::Result<Vec<YtHidden>> {
    let mut stmt = conn.prepare(
        "SELECT video_id, playlist_id, title, channel_title, thumbnail, hidden_at
         FROM yt_hidden WHERE playlist_id = ?1 ORDER BY hidden_at DESC, rowid DESC",
    )?;
    let rows = stmt.query_map(params![playlist_id], |r| {
        Ok(YtHidden {
            video_id: r.get(0)?,
            playlist_id: r.get(1)?,
            title: r.get(2)?,
            channel_title: r.get(3)?,
            thumbnail: r.get(4)?,
            hidden_at: r.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn yt_hide(conn: &Connection, playlist_id: &str, v: YtHideInput) -> rusqlite::Result<()> {
    upsert_hidden(conn, playlist_id, &v)
}

pub fn yt_ban(conn: &Connection, v: YtHideInput) -> rusqlite::Result<()> {
    // A ban supersedes any per-playlist rows for this video.
    conn.execute(
        "DELETE FROM yt_hidden WHERE video_id = ?1 AND playlist_id <> ''",
        params![v.video_id],
    )?;
    upsert_hidden(conn, "", &v)
}

pub fn yt_restore(conn: &Connection, playlist_id: &str, video_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM yt_hidden WHERE video_id = ?1 AND playlist_id = ?2",
        params![video_id, playlist_id],
    )?;
    Ok(())
}

pub fn yt_unban(conn: &Connection, video_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM yt_hidden WHERE video_id = ?1 AND playlist_id = ''",
        params![video_id],
    )?;
    Ok(())
}

pub fn yt_hidden_for_playlist(conn: &Connection, playlist_id: &str) -> rusqlite::Result<Vec<YtHidden>> {
    list_hidden(conn, playlist_id)
}

pub fn yt_bans(conn: &Connection) -> rusqlite::Result<Vec<YtHidden>> {
    list_hidden(conn, "")
}

// ---------------------------------------------------------------------------
// Recents
// ---------------------------------------------------------------------------

pub fn list_recents(conn: &Connection, limit: u32) -> rusqlite::Result<Vec<Recent>> {
    let mut stmt = conn.prepare(
        "SELECT id, source, ref, name, logo, played_at
         FROM recents ORDER BY played_at DESC, rowid DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |r| {
        Ok(Recent {
            id: r.get(0)?,
            source: r.get(1)?,
            ref_: r.get(2)?,
            name: r.get(3)?,
            logo: r.get(4)?,
            played_at: r.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn add_recent(conn: &Connection, input: RecentInput) -> rusqlite::Result<()> {
    // Collapse repeats of the same item to a single most-recent entry.
    conn.execute(
        "DELETE FROM recents WHERE source = ?1 AND ref = ?2",
        params![input.source, input.ref_],
    )?;
    let id = gen_id("rec");
    let now = now_millis();
    conn.execute(
        "INSERT INTO recents (id, source, ref, name, logo, played_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, input.source, input.ref_, input.name, input.logo, now],
    )?;
    // Trim to the most-recent rows.
    conn.execute(
        "DELETE FROM recents WHERE id NOT IN (
            SELECT id FROM recents ORDER BY played_at DESC, rowid DESC LIMIT ?1
         )",
        params![RECENTS_LIMIT],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Catalog cache
// ---------------------------------------------------------------------------

/// Return the cached catalog JSON if it exists and is younger than `max_age_ms`.
pub fn get_cached_catalog(conn: &Connection, max_age_ms: i64) -> rusqlite::Result<Option<String>> {
    let row: Option<(String, i64)> = conn
        .query_row(
            "SELECT json, fetched_at FROM catalog_cache WHERE key = 'catalog'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    Ok(match row {
        Some((json, fetched_at)) if now_millis() - fetched_at < max_age_ms => Some(json),
        _ => None,
    })
}

pub fn store_catalog(conn: &Connection, json: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO catalog_cache (key, json, fetched_at) VALUES ('catalog', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at",
        params![json, now_millis()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        conn
    }

    #[test]
    fn kv_round_trips() {
        let conn = mem();
        assert_eq!(kv_get(&conn, "yt_collections").unwrap(), None);
        kv_set(&conn, "yt_collections", "[{\"id\":\"a\"}]").unwrap();
        assert_eq!(
            kv_get(&conn, "yt_collections").unwrap().as_deref(),
            Some("[{\"id\":\"a\"}]")
        );
        kv_set(&conn, "yt_collections", "[]").unwrap();
        assert_eq!(kv_get(&conn, "yt_collections").unwrap().as_deref(), Some("[]"));
    }

    #[test]
    fn settings_defaults_and_patch() {
        let conn = mem();
        let s = get_settings(&conn).unwrap();
        assert_eq!(s.youtube_api_key, None);
        assert!(!s.nsfw);
        assert_eq!(s.default_volume, 0.7);

        set_settings(
            &conn,
            SettingsPatch {
                youtube_api_key: Some(Some("KEY123".into())),
                nsfw: Some(true),
                default_volume: Some(0.4),
            },
        )
        .unwrap();
        let s = get_settings(&conn).unwrap();
        assert_eq!(s.youtube_api_key.as_deref(), Some("KEY123"));
        assert!(s.nsfw);
        assert_eq!(s.default_volume, 0.4);

        // Patch with only one field leaves the others untouched.
        set_settings(
            &conn,
            SettingsPatch {
                youtube_api_key: None,
                nsfw: Some(false),
                default_volume: None,
            },
        )
        .unwrap();
        let s = get_settings(&conn).unwrap();
        assert_eq!(s.youtube_api_key.as_deref(), Some("KEY123"));
        assert!(!s.nsfw);
        assert_eq!(s.default_volume, 0.4);

        // Explicit null clears the key.
        set_settings(
            &conn,
            SettingsPatch {
                youtube_api_key: Some(None),
                nsfw: None,
                default_volume: None,
            },
        )
        .unwrap();
        assert_eq!(get_settings(&conn).unwrap().youtube_api_key, None);
    }

    #[test]
    fn favorites_upsert_and_remove() {
        let conn = mem();
        let a = add_favorite(
            &conn,
            FavoriteInput {
                source: "tv".into(),
                ref_: "Alpha.us".into(),
                name: "Alpha".into(),
                logo: None,
                meta_json: None,
            },
        )
        .unwrap();
        // Re-adding the same (source, ref) upserts, keeping one row + same id.
        let b = add_favorite(
            &conn,
            FavoriteInput {
                source: "tv".into(),
                ref_: "Alpha.us".into(),
                name: "Alpha Renamed".into(),
                logo: Some("http://l".into()),
                meta_json: None,
            },
        )
        .unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(b.name, "Alpha Renamed");
        assert_eq!(list_favorites(&conn).unwrap().len(), 1);

        remove_favorite(&conn, "tv", "Alpha.us").unwrap();
        assert!(list_favorites(&conn).unwrap().is_empty());
    }

    #[test]
    fn recents_dedupe_and_trim() {
        let conn = mem();
        for i in 0..3 {
            add_recent(
                &conn,
                RecentInput {
                    source: "radio".into(),
                    ref_: format!("st{i}"),
                    name: format!("Station {i}"),
                    logo: None,
                },
            )
            .unwrap();
        }
        // Replay an existing one -> still a single row for it.
        add_recent(
            &conn,
            RecentInput {
                source: "radio".into(),
                ref_: "st1".into(),
                name: "Station 1".into(),
                logo: None,
            },
        )
        .unwrap();
        let recents = list_recents(&conn, 10).unwrap();
        assert_eq!(recents.len(), 3);
        // Most recent first => the replayed st1.
        assert_eq!(recents[0].ref_, "st1");
    }

    #[test]
    fn yt_hide_is_per_playlist() {
        let conn = mem();
        let v = YtHideInput { video_id: "v1".into(), title: "T".into(), channel_title: "C".into(), thumbnail: "th".into() };
        yt_hide(&conn, "PL1", v).unwrap();
        assert_eq!(yt_hidden_for_playlist(&conn, "PL1").unwrap().len(), 1);
        assert!(yt_hidden_for_playlist(&conn, "PL2").unwrap().is_empty());
        assert!(yt_bans(&conn).unwrap().is_empty());
    }

    #[test]
    fn yt_ban_collapses_per_playlist_rows() {
        let conn = mem();
        let mk = || YtHideInput { video_id: "v1".into(), title: "T".into(), channel_title: "C".into(), thumbnail: "th".into() };
        yt_hide(&conn, "PL1", mk()).unwrap();
        yt_ban(&conn, mk()).unwrap();
        assert!(yt_hidden_for_playlist(&conn, "PL1").unwrap().is_empty());
        assert_eq!(yt_bans(&conn).unwrap().len(), 1);
    }

    #[test]
    fn yt_restore_and_unban_are_scoped() {
        let conn = mem();
        let mk = || YtHideInput { video_id: "v1".into(), title: "".into(), channel_title: "".into(), thumbnail: "".into() };
        yt_hide(&conn, "PL1", mk()).unwrap();
        yt_ban(&conn, mk()).unwrap();
        yt_restore(&conn, "PL1", "v1").unwrap(); // no-op now (ban collapsed it)
        assert_eq!(yt_bans(&conn).unwrap().len(), 1);
        yt_unban(&conn, "v1").unwrap();
        assert!(yt_bans(&conn).unwrap().is_empty());
    }

    #[test]
    fn yt_rehide_upserts() {
        let conn = mem();
        let mk = |t: &str| YtHideInput { video_id: "v1".into(), title: t.into(), channel_title: "".into(), thumbnail: "".into() };
        yt_hide(&conn, "PL1", mk("first")).unwrap();
        yt_hide(&conn, "PL1", mk("second")).unwrap();
        let rows = yt_hidden_for_playlist(&conn, "PL1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "second");
    }
}
