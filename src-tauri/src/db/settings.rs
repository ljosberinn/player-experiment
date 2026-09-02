//! The `settings` key/value table.
//!
//! Small, rarely-read preferences that belong to the library rather than to a
//! track: volume today, window geometry and the last view later.

use rusqlite::{Connection, OptionalExtension};

use crate::error::AppResult;

pub const VOLUME: &str = "player.volume";
/// Whether output is muted. Stored beside the volume rather than folded into
/// it: a muted player still knows what level to come back to, and a stored
/// zero would lose that.
pub const MUTED: &str = "player.muted";
pub const WINDOW_GEOMETRY: &str = "window.geometry";
/// The library view's column layout; a playlist's own lives on its row.
pub const COLUMNS: &str = "library.columns";
/// Webview zoom factor, applied before the window is shown.
pub const ZOOM: &str = "window.zoom";
/// Which sidebar sections the user has collapsed. Opaque JSON, like the column
/// layout: which sections exist is the frontend's business, and mirroring that
/// here would be two definitions to keep in step for nothing.
pub const SIDEBAR: &str = "sidebar.sections";
/// Unix seconds of the most recent crash the user has dismissed. Deliberately
/// not exportable: it describes this machine's history, not the library.
pub const CRASH_SEEN: &str = "crash.seen";
/// Whether the background takes its colours from the playing cover.
///
/// On unless it has been turned off - the design draws the blobs, so their
/// absence is the departure that has to be stored rather than their presence.
pub const DYNAMIC_BACKGROUND: &str = "appearance.dynamicBackground";
/// Set once the built-in smart playlists have been created. A flag rather than
/// a check for the playlists themselves, so deleting Most Played deletes it
/// instead of asking for it back on the next launch.
pub const PLAYLISTS_SEEDED: &str = "playlists.seeded";
/// Set once every stored cover has been through `db::covers::normalize`.
///
/// A flag in the shape of [`PLAYLISTS_SEEDED`] rather than a migration:
/// re-encoding a library's worth of artwork is half a minute of CPU, and
/// migration 6 already settled that this must not happen in the transaction
/// that runs before the window is shown.
pub const COVERS_NORMALIZED: &str = "covers.normalized";
/// The last hash that pass finished, so a run cut short by a quit resumes
/// instead of re-encoding a generation onto what it already did.
pub const COVERS_NORMALIZED_THROUGH: &str = "covers.normalizedThrough";

/// The last.fm session key. **Stored unencrypted, on purpose.**
///
/// Not an oversight and not a shortcut - see `docs/plans/lastfm.md`. The short
/// version: the browser token flow means this is not the user's password but a
/// token granting scrobbling on one account, revocable from last.fm's own
/// settings screen; DPAPI would cost the crate's `unsafe_code = "forbid"`
/// permanently; and of eleven surveyed open-source clients, eight keep it in a
/// plain app-owned file and none use app-level encryption.
///
/// **What must not be built here is encryption under a constant compiled into
/// the binary.** It reads like protection in review and is worth about as much
/// as plaintext, with the added cost that nobody can tell at a glance how
/// exposed the secret is. If it is unencrypted, it must look unencrypted.
///
/// Excluded from an export by [`EXPORTABLE`] being an allowlist.
pub const LASTFM_SESSION_KEY: &str = "lastfm.sessionKey";
/// Which account the session key belongs to, for the status line.
///
/// Not a credential, but not exportable either: it names a person, and an
/// export is a copy of a library rather than of an account.
pub const LASTFM_USERNAME: &str = "lastfm.username";

/// Settings a library export is allowed to carry.
///
/// **An allowlist, not a denylist.** The plan called for a denylist so that
/// last.fm and Discogs credentials could never leak into an export; an
/// allowlist gets the same result and fails the safe way round. Forgetting to
/// list a new credential key on a denylist leaks it; forgetting to list a new
/// preference here merely omits it from an export, which nobody loses sleep
/// over. Every future secret is excluded by default rather than by memory.
const EXPORTABLE: &[&str] = &[VOLUME, MUTED, WINDOW_GEOMETRY, ZOOM, DYNAMIC_BACKGROUND];

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

/// Whether the last session left the player muted.
///
/// Anything other than the two values this writes reads as unmuted: starting a
/// player silent because of a corrupt setting is the worse of the two ways to
/// be wrong.
pub fn muted(conn: &Connection) -> AppResult<bool> {
    Ok(get(conn, MUTED)?.as_deref() == Some("true"))
}

/// Whether the cover-coloured background is on.
///
/// Unset means on, which is the design's default, and so does anything other
/// than the explicit "false" this writes: a corrupt setting should leave the
/// app looking the way it is drawn rather than quietly plainer.
pub fn dynamic_background(conn: &Connection) -> AppResult<bool> {
    Ok(get(conn, DYNAMIC_BACKGROUND)?.as_deref() != Some("false"))
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
    fn muted_defaults_to_off_and_round_trips() {
        let (_dir, conn) = conn();
        assert!(!muted(&conn).unwrap());

        set(&conn, MUTED, "true").unwrap();
        assert!(muted(&conn).unwrap());

        set(&conn, MUTED, "false").unwrap();
        assert!(!muted(&conn).unwrap());
    }

    #[test]
    fn a_corrupt_mute_starts_the_player_audible() {
        let (_dir, conn) = conn();
        set(&conn, MUTED, "yes please").unwrap();
        assert!(!muted(&conn).unwrap());
    }

    #[test]
    fn an_export_carries_known_preferences_and_nothing_else() {
        let (_dir, conn) = conn();
        set(&conn, VOLUME, "0.5").unwrap();
        set(&conn, WINDOW_GEOMETRY, "{}").unwrap();
        // The credential phase 10 actually stores, plus the shape phase 12
        // will.
        set(&conn, LASTFM_SESSION_KEY, "super-secret").unwrap();
        set(&conn, LASTFM_USERNAME, "listener").unwrap();
        set(&conn, "discogs.token", "also-secret").unwrap();
        // And something nobody has thought of yet.
        set(&conn, "something.new", "unknown").unwrap();

        let exported = exportable(&conn).unwrap();
        let keys: Vec<&str> = exported.iter().map(|(key, _)| key.as_str()).collect();

        assert_eq!(keys, [VOLUME, WINDOW_GEOMETRY]);
        // The point of the allowlist: a key added later is excluded by
        // default, rather than by someone remembering to deny it.
        assert!(!is_exportable("something.new"));
        // The guard the last.fm phase is about not leaking rather than about
        // working: the session key is a credential, and an export is a file
        // the user hands to someone else.
        assert!(!is_exportable(LASTFM_SESSION_KEY));
        assert!(!is_exportable(LASTFM_USERNAME));
        // And the two that describe this machine's window rather than the
        // library. An export carried to another machine has no business
        // folding its sidebar or resizing its columns.
        assert!(!is_exportable(SIDEBAR));
        assert!(!is_exportable(COLUMNS));
        // Taste rather than geometry, and so on the other side of that line -
        // it travels with the library the way the volume and the zoom do.
        assert!(is_exportable(DYNAMIC_BACKGROUND));
    }

    #[test]
    fn the_dynamic_background_is_on_until_it_is_turned_off() {
        let (_dir, conn) = conn();
        assert!(dynamic_background(&conn).unwrap());

        set(&conn, DYNAMIC_BACKGROUND, "false").unwrap();
        assert!(!dynamic_background(&conn).unwrap());

        set(&conn, DYNAMIC_BACKGROUND, "true").unwrap();
        assert!(dynamic_background(&conn).unwrap());

        // And a value neither of those, which must not turn the design off.
        set(&conn, DYNAMIC_BACKGROUND, "maybe").unwrap();
        assert!(dynamic_background(&conn).unwrap());
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
