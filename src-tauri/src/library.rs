//! Personal Library: local-folder scanning, audio tags, and SQLite persistence.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS lib_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER NOT NULL REFERENCES lib_folders(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT NOT NULL,
  genre TEXT NOT NULL,
  year INTEGER,
  track_no INTEGER,
  duration_sec INTEGER NOT NULL,
  art_path TEXT,
  mtime INTEGER NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracks_folder ON tracks(folder_id);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);
"#;

/// Accent colors assigned to new groups, cycled by folder count.
const COLORS: [&str; 8] = [
    "#3fb950", "#549bff", "#e3b341", "#f0635c", "#8b5cf6", "#06b6d4", "#ec4899", "#10b981",
];

/// File extensions treated as audio.
const AUDIO_EXTS: [&str; 8] = ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "aiff"];

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("PRAGMA foreign_keys = ON", [])?;
    conn.execute_batch(SCHEMA)
}

// ---------------------------------------------------------------------------
// Shapes (camelCase wire format)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibFolder {
    pub id: i64,
    pub path: String,
    pub label: String,
    pub color: String,
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    pub folder_id: i64,
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genre: String,
    pub year: Option<i64>,
    pub track_no: Option<i64>,
    pub duration_sec: i64,
    pub art_path: Option<String>,
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistCount {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumInfo {
    pub name: String,
    pub artist: String,
    pub count: i64,
    pub art_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenreCount {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub count: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub added: i64,
    pub removed: i64,
    pub updated: i64,
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

/// True if `path` has an extension in the audio whitelist (case-insensitive).
pub fn is_audio_ext(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => AUDIO_EXTS.contains(&ext.to_ascii_lowercase().as_str()),
        None => false,
    }
}

/// Folder display label = the final path component, else the whole path.
fn folder_label(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

pub fn list_folders(conn: &Connection) -> rusqlite::Result<Vec<LibFolder>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, label, color, added_at FROM lib_folders ORDER BY added_at ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(LibFolder {
            id: r.get(0)?,
            path: r.get(1)?,
            label: r.get(2)?,
            color: r.get(3)?,
            added_at: r.get(4)?,
        })
    })?;
    rows.collect()
}

/// Insert a folder (or return the existing row if the path is already present).
pub fn add_folder(conn: &Connection, path: &str) -> rusqlite::Result<LibFolder> {
    let existing: Option<i64> = conn
        .query_row("SELECT id FROM lib_folders WHERE path = ?1", params![path], |r| r.get(0))
        .optional()?;
    if existing.is_none() {
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM lib_folders", [], |r| r.get(0))?;
        let color = COLORS[(count as usize) % COLORS.len()];
        conn.execute(
            "INSERT INTO lib_folders (path, label, color, added_at) VALUES (?1, ?2, ?3, ?4)",
            params![path, folder_label(path), color, now_millis()],
        )?;
    }
    conn.query_row(
        "SELECT id, path, label, color, added_at FROM lib_folders WHERE path = ?1",
        params![path],
        |r| {
            Ok(LibFolder {
                id: r.get(0)?,
                path: r.get(1)?,
                label: r.get(2)?,
                color: r.get(3)?,
                added_at: r.get(4)?,
            })
        },
    )
}

pub fn remove_folder(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    // ON DELETE CASCADE removes the folder's tracks (and their playlist links).
    conn.execute("DELETE FROM lib_folders WHERE id = ?1", params![id])?;
    Ok(())
}

/// Result of diffing the DB's known files against what's on disk now.
pub struct ScanDiff {
    pub added: Vec<String>,   // paths on disk but not in DB
    pub removed: Vec<String>, // paths in DB but gone from disk
    pub updated: Vec<String>, // paths in both, mtime changed
}

/// Pure set diff of (path, mtime) pairs. `db` = current rows, `disk` = files found.
pub fn diff_scan(db: &[(String, i64)], disk: &[(String, i64)]) -> ScanDiff {
    use std::collections::HashMap;
    let db_map: HashMap<&str, i64> = db.iter().map(|(p, m)| (p.as_str(), *m)).collect();
    let disk_map: HashMap<&str, i64> = disk.iter().map(|(p, m)| (p.as_str(), *m)).collect();

    let mut added = Vec::new();
    let mut updated = Vec::new();
    for (path, mtime) in disk {
        match db_map.get(path.as_str()) {
            None => added.push(path.clone()),
            Some(&old) if old != *mtime => updated.push(path.clone()),
            Some(_) => {}
        }
    }
    let removed: Vec<String> = db
        .iter()
        .filter(|(p, _)| !disk_map.contains_key(p.as_str()))
        .map(|(p, _)| p.clone())
        .collect();
    ScanDiff { added, removed, updated }
}

use std::fs;
use walkdir::WalkDir;
use lofty::prelude::*;
use lofty::picture::PictureType;

/// Tags + properties read from one file.
struct ScannedTags {
    title: String,
    artist: String,
    album: String,
    genre: String,
    year: Option<i64>,
    track_no: Option<i64>,
    duration_sec: i64,
    picture: Option<Vec<u8>>,
}

/// Read tags via lofty, filling sensible fallbacks for missing fields.
fn read_tags(path: &Path) -> ScannedTags {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let tagged = lofty::read_from_path(path).ok();
    let duration_sec = tagged
        .as_ref()
        .map(|t| t.properties().duration().as_secs() as i64)
        .unwrap_or(0);
    let tag = tagged.as_ref().and_then(|t| t.primary_tag().or_else(|| t.first_tag()));

    let s = |opt: Option<std::borrow::Cow<str>>, fallback: &str| -> String {
        opt.map(|c| c.to_string())
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| fallback.to_string())
    };

    let (title, artist, album, genre, year, track_no, picture) = match tag {
        Some(t) => {
            let pic = t
                .pictures()
                .iter()
                .find(|p| p.pic_type() == PictureType::CoverFront)
                .or_else(|| t.pictures().first())
                .map(|p| p.data().to_vec());
            (
                s(t.title(), &stem),
                s(t.artist(), "Unknown Artist"),
                s(t.album(), "Unknown Album"),
                s(t.genre(), "Unknown"),
                t.year().map(|y| y as i64),
                t.track().map(|n| n as i64),
                pic,
            )
        }
        None => (
            stem,
            "Unknown Artist".to_string(),
            "Unknown Album".to_string(),
            "Unknown".to_string(),
            None,
            None,
            None,
        ),
    };

    ScannedTags { title, artist, album, genre, year, track_no, duration_sec, picture }
}

/// Walk a folder, return (absolute path, mtime) for every audio file.
fn scan_disk(root: &str) -> Vec<(String, i64)> {
    WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && is_audio_ext(e.path()))
        .filter_map(|e| {
            let path = e.path().to_str()?.to_string();
            let mtime = e
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            Some((path, mtime))
        })
        .collect()
}

/// Insert or update one track row (matched by path). Writes its embedded art to
/// `<art_dir>/<id>.jpg` when present. Returns nothing; errors are surfaced.
fn upsert_track(
    conn: &Connection,
    folder_id: i64,
    path: &str,
    mtime: i64,
    art_dir: &Path,
) -> rusqlite::Result<()> {
    let tags = read_tags(Path::new(path));
    let now = now_millis();
    conn.execute(
        "INSERT INTO tracks
           (folder_id, path, title, artist, album, genre, year, track_no, duration_sec, mtime, added_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
         ON CONFLICT(path) DO UPDATE SET
           title=excluded.title, artist=excluded.artist, album=excluded.album,
           genre=excluded.genre, year=excluded.year, track_no=excluded.track_no,
           duration_sec=excluded.duration_sec, mtime=excluded.mtime",
        params![
            folder_id, path, tags.title, tags.artist, tags.album, tags.genre,
            tags.year, tags.track_no, tags.duration_sec, mtime, now
        ],
    )?;
    let id: i64 = conn.query_row("SELECT id FROM tracks WHERE path = ?1", params![path], |r| r.get(0))?;

    if let Some(bytes) = tags.picture {
        let _ = fs::create_dir_all(art_dir);
        let art_file = art_dir.join(format!("{id}.jpg"));
        if fs::write(&art_file, &bytes).is_ok() {
            if let Some(p) = art_file.to_str() {
                conn.execute("UPDATE tracks SET art_path = ?1 WHERE id = ?2", params![p, id])?;
            }
        }
    }
    Ok(())
}

/// Rescan one folder (or all when `folder_id` is None). Diffs disk vs DB and
/// applies inserts/updates/removals. `art_dir` = app_data/art.
pub fn rescan(conn: &Connection, folder_id: Option<i64>, art_dir: &Path) -> rusqlite::Result<ScanResult> {
    let folders: Vec<(i64, String)> = {
        let (sql, has_filter) = match folder_id {
            Some(_) => ("SELECT id, path FROM lib_folders WHERE id = ?1", true),
            None => ("SELECT id, path FROM lib_folders", false),
        };
        let mut stmt = conn.prepare(sql)?;
        let map = |r: &rusqlite::Row| Ok((r.get(0)?, r.get(1)?));
        if has_filter {
            stmt.query_map(params![folder_id.unwrap()], map)?.collect::<rusqlite::Result<_>>()?
        } else {
            stmt.query_map([], map)?.collect::<rusqlite::Result<_>>()?
        }
    };

    let mut result = ScanResult::default();
    for (fid, path) in folders {
        // Skip folders whose root is currently unreachable (e.g. unplugged drive)
        // so we don't wipe their tracks. Reachable + file gone => real removal.
        if !Path::new(&path).is_dir() {
            continue;
        }
        let disk = scan_disk(&path);
        let db: Vec<(String, i64)> = {
            let mut stmt = conn.prepare("SELECT path, mtime FROM tracks WHERE folder_id = ?1")?;
            let rows = stmt
                .query_map(params![fid], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<rusqlite::Result<_>>()?;
            rows
        };
        let diff = diff_scan(&db, &disk);
        let disk_mtime: std::collections::HashMap<&str, i64> =
            disk.iter().map(|(p, m)| (p.as_str(), *m)).collect();

        for p in &diff.added {
            upsert_track(conn, fid, p, disk_mtime[p.as_str()], art_dir)?;
            result.added += 1;
        }
        for p in &diff.updated {
            upsert_track(conn, fid, p, disk_mtime[p.as_str()], art_dir)?;
            result.updated += 1;
        }
        for p in &diff.removed {
            conn.execute("DELETE FROM tracks WHERE path = ?1", params![p])?;
            result.removed += 1;
        }
    }
    Ok(result)
}

const TRACK_COLS: &str = "id, folder_id, path, title, artist, album, genre, year, track_no, duration_sec, art_path, added_at";

fn map_track(r: &rusqlite::Row) -> rusqlite::Result<Track> {
    Ok(Track {
        id: r.get(0)?,
        folder_id: r.get(1)?,
        path: r.get(2)?,
        title: r.get(3)?,
        artist: r.get(4)?,
        album: r.get(5)?,
        genre: r.get(6)?,
        year: r.get(7)?,
        track_no: r.get(8)?,
        duration_sec: r.get(9)?,
        art_path: r.get(10)?,
        added_at: r.get(11)?,
    })
}

/// Return tracks for a view: "all" | "recent" | "group" | "artist" | "album" |
/// "genre" | "playlist". `value` is the folder/playlist id (as string) or the
/// artist/album/genre name; ignored for "all"/"recent".
pub fn list_tracks(conn: &Connection, view: &str, value: Option<&str>) -> rusqlite::Result<Vec<Track>> {
    let order = "ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_no, title COLLATE NOCASE";
    match view {
        "all" => {
            let mut stmt = conn.prepare(&format!("SELECT {TRACK_COLS} FROM tracks {order}"))?;
            let rows = stmt.query_map([], map_track)?;
            rows.collect()
        }
        "recent" => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {TRACK_COLS} FROM tracks ORDER BY added_at DESC, id DESC LIMIT 200"
            ))?;
            let rows = stmt.query_map([], map_track)?;
            rows.collect()
        }
        "group" => {
            let id: i64 = value.and_then(|v| v.parse().ok()).unwrap_or(-1);
            let mut stmt = conn.prepare(&format!("SELECT {TRACK_COLS} FROM tracks WHERE folder_id = ?1 {order}"))?;
            let rows = stmt.query_map(params![id], map_track)?;
            rows.collect()
        }
        "artist" => {
            let mut stmt = conn.prepare(&format!("SELECT {TRACK_COLS} FROM tracks WHERE artist = ?1 {order}"))?;
            let rows = stmt.query_map(params![value.unwrap_or("")], map_track)?;
            rows.collect()
        }
        "album" => {
            let mut stmt = conn.prepare(&format!("SELECT {TRACK_COLS} FROM tracks WHERE album = ?1 ORDER BY track_no, title COLLATE NOCASE"))?;
            let rows = stmt.query_map(params![value.unwrap_or("")], map_track)?;
            rows.collect()
        }
        "genre" => {
            let mut stmt = conn.prepare(&format!("SELECT {TRACK_COLS} FROM tracks WHERE genre = ?1 {order}"))?;
            let rows = stmt.query_map(params![value.unwrap_or("")], map_track)?;
            rows.collect()
        }
        "playlist" => {
            let id: i64 = value.and_then(|v| v.parse().ok()).unwrap_or(-1);
            let mut stmt = conn.prepare(&format!(
                "SELECT {TRACK_COLS} FROM tracks t
                 JOIN playlist_tracks pt ON pt.track_id = t.id
                 WHERE pt.playlist_id = ?1 ORDER BY pt.position"
            ))?;
            let rows = stmt.query_map(params![id], map_track)?;
            rows.collect()
        }
        _ => Ok(Vec::new()),
    }
}

pub fn list_artists(conn: &Connection) -> rusqlite::Result<Vec<ArtistCount>> {
    let mut stmt = conn.prepare(
        "SELECT artist, COUNT(*) FROM tracks GROUP BY artist ORDER BY artist COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| Ok(ArtistCount { name: r.get(0)?, count: r.get(1)? }))?;
    rows.collect()
}

pub fn list_genres(conn: &Connection) -> rusqlite::Result<Vec<GenreCount>> {
    let mut stmt = conn.prepare(
        "SELECT genre, COUNT(*) FROM tracks GROUP BY genre ORDER BY genre COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| Ok(GenreCount { name: r.get(0)?, count: r.get(1)? }))?;
    rows.collect()
}

pub fn list_albums(conn: &Connection) -> rusqlite::Result<Vec<AlbumInfo>> {
    let mut stmt = conn.prepare(
        "SELECT album, MIN(artist), COUNT(*),
                (SELECT art_path FROM tracks t2 WHERE t2.album = t1.album AND t2.art_path IS NOT NULL LIMIT 1)
         FROM tracks t1 GROUP BY album ORDER BY album COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(AlbumInfo { name: r.get(0)?, artist: r.get(1)?, count: r.get(2)?, art_path: r.get(3)? })
    })?;
    rows.collect()
}

pub fn list_playlists(conn: &Connection) -> rusqlite::Result<Vec<Playlist>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.created_at, COUNT(pt.track_id)
         FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         GROUP BY p.id ORDER BY p.created_at ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Playlist { id: r.get(0)?, name: r.get(1)?, created_at: r.get(2)?, count: r.get(3)? })
    })?;
    rows.collect()
}

pub fn playlist_create(conn: &Connection, name: &str) -> rusqlite::Result<Playlist> {
    conn.execute(
        "INSERT INTO playlists (name, created_at) VALUES (?1, ?2)",
        params![name, now_millis()],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Playlist { id, name: name.to_string(), created_at: now_millis(), count: 0 })
}

pub fn playlist_rename(conn: &Connection, id: i64, name: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE playlists SET name = ?1 WHERE id = ?2", params![name, id])?;
    Ok(())
}

pub fn playlist_delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn playlist_add(conn: &Connection, playlist_id: i64, track_id: i64) -> rusqlite::Result<()> {
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?1",
        params![playlist_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)
         ON CONFLICT(playlist_id, track_id) DO NOTHING",
        params![playlist_id, track_id, next],
    )?;
    Ok(())
}

pub fn playlist_remove(conn: &Connection, playlist_id: i64, track_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
        params![playlist_id, track_id],
    )?;
    Ok(())
}

/// Rewrite positions to match the given track order.
pub fn playlist_reorder(conn: &Connection, playlist_id: i64, track_ids: &[i64]) -> rusqlite::Result<()> {
    for (pos, tid) in track_ids.iter().enumerate() {
        conn.execute(
            "UPDATE playlist_tracks SET position = ?1 WHERE playlist_id = ?2 AND track_id = ?3",
            params![pos as i64, playlist_id, tid],
        )?;
    }
    Ok(())
}

/// Absolute path of a track row, for trashing/reveal.
pub fn track_path(conn: &Connection, id: i64) -> rusqlite::Result<String> {
    conn.query_row("SELECT path FROM tracks WHERE id = ?1", params![id], |r| r.get(0))
}

/// Delete a track row (used after the file itself is sent to the OS Trash).
pub fn track_delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM playlist_tracks WHERE track_id = ?1", params![id])?;
    conn.execute("DELETE FROM tracks WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        conn
    }

    #[test]
    fn audio_ext_whitelist() {
        assert!(is_audio_ext(&PathBuf::from("/m/song.mp3")));
        assert!(is_audio_ext(&PathBuf::from("/m/song.FLAC")));
        assert!(is_audio_ext(&PathBuf::from("/m/a.OpUs")));
        assert!(!is_audio_ext(&PathBuf::from("/m/cover.jpg")));
        assert!(!is_audio_ext(&PathBuf::from("/m/readme")));
    }

    #[test]
    fn scan_diff_classifies_changes() {
        // DB has A(mtime 10), B(mtime 20). Disk has A(10 unchanged),
        // B(25 changed), C(30 new). B updated, C added, (none removed here).
        let db = vec![("A".to_string(), 10i64), ("B".to_string(), 20)];
        let disk = vec![
            ("A".to_string(), 10i64),
            ("B".to_string(), 25),
            ("C".to_string(), 30),
        ];
        let d = diff_scan(&db, &disk);
        assert_eq!(d.added, vec!["C".to_string()]);
        assert_eq!(d.updated, vec!["B".to_string()]);
        assert!(d.removed.is_empty());

        // Now disk drops A -> A removed.
        let disk2 = vec![("B".to_string(), 25i64)];
        let d2 = diff_scan(&db, &disk2);
        assert_eq!(d2.removed, vec!["A".to_string()]);
    }

    #[test]
    fn folders_add_dedupe_label_color_remove() {
        let conn = mem();
        let a = add_folder(&conn, "/Users/x/Music/Pop").unwrap();
        assert_eq!(a.label, "Pop");
        assert_eq!(a.color, "#3fb950");
        // Re-adding the same path returns the same row, not a duplicate.
        let a2 = add_folder(&conn, "/Users/x/Music/Pop").unwrap();
        assert_eq!(a.id, a2.id);
        assert_eq!(list_folders(&conn).unwrap().len(), 1);
        // Second distinct folder gets the next color.
        let b = add_folder(&conn, "/Users/x/Music/Rock").unwrap();
        assert_eq!(b.color, "#549bff");
        assert_eq!(list_folders(&conn).unwrap().len(), 2);

        remove_folder(&conn, a.id).unwrap();
        let left = list_folders(&conn).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, b.id);
    }

    fn seed_track(conn: &Connection, folder_id: i64, path: &str, artist: &str, album: &str, genre: &str) {
        conn.execute(
            "INSERT INTO tracks (folder_id, path, title, artist, album, genre, duration_sec, mtime, added_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![folder_id, path, path, artist, album, genre, 180, 1, 1],
        ).unwrap();
    }

    #[test]
    fn track_views_and_rollups() {
        let conn = mem();
        let f1 = add_folder(&conn, "/m/Pop").unwrap().id;
        let f2 = add_folder(&conn, "/m/Rock").unwrap().id;
        seed_track(&conn, f1, "/m/Pop/a.mp3", "Mara", "Daylight", "Pop");
        seed_track(&conn, f1, "/m/Pop/b.mp3", "Mara", "Daylight", "Pop");
        seed_track(&conn, f2, "/m/Rock/c.mp3", "Mara", "Loud", "Rock");

        // group view = one folder
        assert_eq!(list_tracks(&conn, "group", Some("1")).unwrap().len(), 2);
        // all
        assert_eq!(list_tracks(&conn, "all", None).unwrap().len(), 3);
        // artist cross-folder
        assert_eq!(list_tracks(&conn, "artist", Some("Mara")).unwrap().len(), 3);
        // album
        assert_eq!(list_tracks(&conn, "album", Some("Daylight")).unwrap().len(), 2);

        let artists = list_artists(&conn).unwrap();
        assert_eq!(artists.len(), 1);
        assert_eq!(artists[0].name, "Mara");
        assert_eq!(artists[0].count, 3);

        let genres = list_genres(&conn).unwrap();
        assert_eq!(genres.len(), 2); // Pop, Rock

        let albums = list_albums(&conn).unwrap();
        assert_eq!(albums.len(), 2); // Daylight, Loud
        let _ = f2; // silence unused if not referenced elsewhere
    }

    #[test]
    fn playlists_crud_and_reorder() {
        let conn = mem();
        let f = add_folder(&conn, "/m/Pop").unwrap().id;
        seed_track(&conn, f, "/m/Pop/a.mp3", "A", "Al", "Pop");
        seed_track(&conn, f, "/m/Pop/b.mp3", "B", "Al", "Pop");
        let t1: i64 = conn.query_row("SELECT id FROM tracks WHERE path='/m/Pop/a.mp3'", [], |r| r.get(0)).unwrap();
        let t2: i64 = conn.query_row("SELECT id FROM tracks WHERE path='/m/Pop/b.mp3'", [], |r| r.get(0)).unwrap();

        let p = playlist_create(&conn, "Gym").unwrap();
        playlist_add(&conn, p.id, t1).unwrap();
        playlist_add(&conn, p.id, t2).unwrap();
        // order = insertion order (t1 then t2)
        let tracks = list_tracks(&conn, "playlist", Some(&p.id.to_string())).unwrap();
        assert_eq!(tracks[0].id, t1);
        // reorder -> t2 first
        playlist_reorder(&conn, p.id, &[t2, t1]).unwrap();
        let tracks = list_tracks(&conn, "playlist", Some(&p.id.to_string())).unwrap();
        assert_eq!(tracks[0].id, t2);
        // count reflected in list
        assert_eq!(list_playlists(&conn).unwrap()[0].count, 2);
        // remove + delete
        playlist_remove(&conn, p.id, t2).unwrap();
        assert_eq!(list_tracks(&conn, "playlist", Some(&p.id.to_string())).unwrap().len(), 1);
        playlist_delete(&conn, p.id).unwrap();
        assert!(list_playlists(&conn).unwrap().is_empty());
    }

    #[test]
    fn track_delete_removes_row() {
        let conn = mem();
        let f = add_folder(&conn, "/m/Pop").unwrap().id;
        seed_track(&conn, f, "/m/Pop/a.mp3", "A", "Al", "Pop");
        let id: i64 = conn.query_row("SELECT id FROM tracks WHERE path='/m/Pop/a.mp3'", [], |r| r.get(0)).unwrap();
        assert_eq!(track_path(&conn, id).unwrap(), "/m/Pop/a.mp3");
        track_delete(&conn, id).unwrap();
        assert_eq!(list_tracks(&conn, "all", None).unwrap().len(), 0);
    }
}
