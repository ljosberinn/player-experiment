//! The `settings` key/value table.
//!
//! Small, rarely-read preferences that belong to the library rather than to a
//! track: volume today, window geometry and the last view later.

use rusqlite::{Connection, OptionalExtension};

use crate::error::AppResult;

pub const VOLUME: &str = "player.volume";
pub const WINDOW_GEOMETRY: &str = "window.geometry";
/// The library view's column layout; a playlist's own lives on its row.
pub const COLUMNS: &str = "library.columns";
/// Webview zoom factor, applied before the window is shown.
pub const ZOOM: &str = "window.zoom";

/// Settings a library export is allowed to carry.
///
/// **An allowlist, not a denylist.** The plan called for a denylist so that
/// last.fm and Discogs credentials could never leak into an export; an
/// allowlist gets the same result and fails the safe way round. Forgetting to
/// list a new credential key on a denylist leaks it; forgetting to list a new
/// preference here merely omits it from an export, which nobody loses sleep
/// over. Every future secret is excluded by default rather than by memory.
const EXPORTABLE: &[&str] = &[VOLUME, WINDOW_GEOMETRY, ZOOM];

pub fn is_exportable(key: &str) -> bool {
    EXPORTABLE.contains(&key)
}

/// Every setting an export may include, in a stable order.
pub fn exportable(conn: &Connection) -> AppResult<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
    let all = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(all
        .into_iter()
        .filter(|(key, _)| is_exportable(key))
        .collect())
}

pub fn get(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?)
}

pub fn set(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

/// The stored volume, or a sensible default.
///
/// Anything unparseable or out of range is treated as absent: a corrupt
/// setting must not start the app at silence or at a value the slider cannot
/// represent.
pub fn volume(conn: &Connection) -> AppResult<f32> {
    const DEFAULT: f32 = 0.8;
    Ok(get(conn, VOLUME)?
        .and_then(|value| value.parse::<f32>().ok())
        .filter(|value| (0.0..=1.0).contains(value))
        .unwrap_or(DEFAULT))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn conn() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    #[test]
    fn reads_back_what_it_wrote() {
        let (_dir, conn) = conn();
        assert_eq!(get(&conn, "a").unwrap(), None);

        set(&conn, "a", "1").unwrap();
        assert_eq!(get(&conn, "a").unwrap(), Some("1".to_owned()));
    }

    #[test]
    fn writing_the_same_key_twice_updates_rather_than_fails() {
        let (_dir, conn) = conn();
        set(&conn, "a", "1").unwrap();
        set(&conn, "a", "2").unwrap();
        assert_eq!(get(&conn, "a").unwrap(), Some("2".to_owned()));
    }

    #[test]
    fn volume_defaults_when_unset() {
        let (_dir, conn) = conn();
        assert_eq!(volume(&conn).unwrap(), 0.8);
    }

    #[test]
    fn volume_round_trips() {
        let (_dir, conn) = conn();
        set(&conn, VOLUME, "0.25").unwrap();
        assert_eq!(volume(&conn).unwrap(), 0.25);
    }

    #[test]
    fn an_export_carries_known_preferences_and_nothing_else() {
        let (_dir, conn) = conn();
        set(&conn, VOLUME, "0.5").unwrap();
        set(&conn, WINDOW_GEOMETRY, "{}").unwrap();
        // Exactly the shape phases 10 and 12 will store.
        set(&conn, "lastfm.session_key", "super-secret").unwrap();
        set(&conn, "discogs.token", "also-secret").unwrap();
        // And something nobody has thought of yet.
        set(&conn, "something.new", "unknown").unwrap();

        let exported = exportable(&conn).unwrap();
        let keys: Vec<&str> = exported.iter().map(|(key, _)| key.as_str()).collect();

        assert_eq!(keys, [VOLUME, WINDOW_GEOMETRY]);
        // The point of the allowlist: a key added later is excluded by
        // default, rather than by someone remembering to deny it.
        assert!(!is_exportable("something.new"));
        assert!(!is_exportable("lastfm.session_key"));
    }

    #[test]
    fn a_corrupt_or_out_of_range_volume_falls_back_to_the_default() {
        let (_dir, conn) = conn();

        set(&conn, VOLUME, "loud").unwrap();
        assert_eq!(volume(&conn).unwrap(), 0.8);

        set(&conn, VOLUME, "17").unwrap();
        assert_eq!(volume(&conn).unwrap(), 0.8);
    }
}
