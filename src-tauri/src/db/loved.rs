//! The loved set: which songs the user loves.
//!
//! Keyed by [`crate::db::plays::match_key`] and nothing else, because loved is
//! a fact about a song rather than about a play or about a file - see schema
//! migration 13. `tracks.match_key` (migration 18) is the bridge back to rows,
//! so a song never played is as lovable as one heard a thousand times.
//!
//! Local state first. A connected last.fm account mirrors it through
//! `lastfm::love`, and `remote` records which keys last.fm itself reported:
//! only those can be taken away by what last.fm reports next.

use std::collections::BTreeSet;

use rusqlite::{Connection, OptionalExtension};

use crate::error::AppResult;

/// The tracks in the loved set, as a subquery over `tracks.id`.
///
/// No NULL can reach a `NOT IN` over it: `id` is the primary key, and a track
/// whose key is NULL matches nothing in `IN`.
pub const MEMBERS: &str = "SELECT id FROM tracks \
                           WHERE match_key IN (SELECT match_key FROM loved)";

/// Every library track the set resolves to.
///
/// The whole set rather than a membership test per track: the window holds it
/// as one set and reads it without a round trip, which is what lets a menu
/// built under the pointer say `Love` or `Unlove` without waiting.
pub fn tracks(conn: &Connection) -> AppResult<Vec<i64>> {
    let mut statement = conn.prepare(MEMBERS)?;
    let ids = statement
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<i64>, _>>()?;
    Ok(ids)
}

/// Adds keys to the set, ignoring the ones already in it.
///
/// `OR IGNORE`, so a key last.fm already reported keeps its `remote` flag
/// when the user loves the song again here.
pub fn remember(conn: &Connection, keys: &[String]) -> AppResult<()> {
    let mut insert = conn.prepare("INSERT OR IGNORE INTO loved (match_key) VALUES (?1)")?;
    for key in keys {
        insert.execute([key])?;
    }
    Ok(())
}

/// Removes keys from the set. Keys it does not hold are not an error.
pub fn forget(conn: &Connection, keys: &[String]) -> AppResult<()> {
    let mut delete = conn.prepare("DELETE FROM loved WHERE match_key = ?1")?;
    for key in keys {
        delete.execute([key])?;
    }
    Ok(())
}

/// Moves the set to what the connected account holds, leaving `pending` alone.
///
/// Three-way rather than wholesale: a key leaves only if last.fm reported it
/// before and no longer does, which is an unlove made on the website or a
/// phone. A love made here that last.fm autocorrected comes back under another
/// key, never under this one, and stays. `pending` is what the love queue has
/// not delivered yet; the user's latest word on those is the local one.
///
/// The caller owns the transaction: the fetch has paged everything before it
/// gets here, so the set moves whole or not at all.
pub fn mirror(
    conn: &Connection,
    reported: &BTreeSet<String>,
    pending: &BTreeSet<String>,
) -> AppResult<()> {
    let mut upsert = conn.prepare(
        "INSERT INTO loved (match_key, remote) VALUES (?1, 1)
         ON CONFLICT(match_key) DO UPDATE SET remote = 1",
    )?;
    for key in reported.difference(pending) {
        upsert.execute([key])?;
    }

    let gone: Vec<String> = remote(conn)?
        .into_iter()
        .filter(|key| !reported.contains(key) && !pending.contains(key))
        .collect();
    forget(conn, &gone)
}

/// Treats every key as local, for an account the set was never synced with.
///
/// What `remote` described was another account's set, or none at all; what
/// the new one lacks is pushed to it rather than read as unloved.
pub fn disown(conn: &Connection) -> AppResult<()> {
    conn.execute("UPDATE loved SET remote = 0", [])?;
    Ok(())
}

/// The keys last.fm has not reported, which are the loves made here.
pub fn local(conn: &Connection) -> AppResult<Vec<String>> {
    keys_where(conn, "remote = 0")
}

fn remote(conn: &Connection) -> AppResult<Vec<String>> {
    keys_where(conn, "remote = 1")
}

fn keys_where(conn: &Connection, condition: &str) -> AppResult<Vec<String>> {
    let mut statement = conn.prepare(&format!("SELECT match_key FROM loved WHERE {condition}"))?;
    let keys = statement
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(keys)
}

/// The artist and title last.fm is sent for a key, off the track it resolves
/// to, or `None` for a key no library track carries.
///
/// Present before missing and the older id first, `plays::resolve`'s tiebreak,
/// so the same song on an album and a compilation always sends one spelling.
pub fn song(conn: &Connection, key: &str) -> AppResult<Option<(String, String)>> {
    Ok(conn
        .query_row(
            "SELECT artist, title FROM tracks WHERE match_key = ?1
              ORDER BY missing_since IS NOT NULL, id LIMIT 1",
            [key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::plays::match_key;
    use crate::db::Db;

    fn conn() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    fn keys(conn: &Connection) -> Vec<(String, bool)> {
        conn.prepare("SELECT match_key, remote FROM loved ORDER BY match_key")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    fn set(keys: &[&str]) -> BTreeSet<String> {
        keys.iter().map(|key| (*key).to_owned()).collect()
    }

    fn track(conn: &Connection, id: i64, artist: &str, title: &str) {
        conn.execute(
            "INSERT INTO tracks (id, path, mtime, size, duration_ms, added_at, artist, title, match_key)
             VALUES (?1, ?2, 0, 0, 1000, 0, ?3, ?4, ?5)",
            rusqlite::params![id, format!("/{id}.mp3"), artist, title, match_key(artist, title)],
        )
        .unwrap();
    }

    #[test]
    fn loving_the_same_song_twice_leaves_one_row() {
        let (_dir, conn) = conn();
        let key = match_key("Nachtmystium", "Every Last Drop");

        remember(&conn, std::slice::from_ref(&key)).unwrap();
        remember(&conn, std::slice::from_ref(&key)).unwrap();

        assert_eq!(keys(&conn), vec![(key, false)]);
    }

    #[test]
    fn loving_again_here_keeps_what_last_fm_reported() {
        let (_dir, conn) = conn();
        mirror(&conn, &set(&["a"]), &set(&[])).unwrap();

        remember(&conn, &["a".to_owned()]).unwrap();

        assert_eq!(keys(&conn), vec![("a".to_owned(), true)]);
    }

    #[test]
    fn forgetting_a_key_the_set_never_held_is_not_an_error() {
        let (_dir, conn) = conn();
        forget(&conn, &["absent".to_owned()]).unwrap();
        assert!(keys(&conn).is_empty());
    }

    #[test]
    fn a_song_never_played_is_in_the_set() {
        let (_dir, conn) = conn();
        track(&conn, 7, "Nachtmystium", "Every Last Drop");
        track(&conn, 8, "Marathonmann", "Holzwege");

        remember(&conn, &[match_key("Nachtmystium", "Every Last Drop")]).unwrap();

        assert_eq!(tracks(&conn).unwrap(), vec![7]);
    }

    #[test]
    fn a_key_names_every_track_that_carries_it() {
        // The album cut and the compilation cut are one song: loving either
        // loves both.
        let (_dir, conn) = conn();
        track(&conn, 1, "Blue Room", "Harbour");
        track(&conn, 2, "Blue Room", "Harbour");

        remember(&conn, &[match_key("Blue Room", "Harbour")]).unwrap();

        assert_eq!(tracks(&conn).unwrap(), vec![1, 2]);
    }

    #[test]
    fn a_love_with_no_track_yet_surfaces_when_the_song_arrives() {
        let (_dir, conn) = conn();
        remember(&conn, &[match_key("Blue Room", "Harbour")]).unwrap();
        assert!(tracks(&conn).unwrap().is_empty());

        track(&conn, 1, "Blue Room", "Harbour");

        assert_eq!(tracks(&conn).unwrap(), vec![1]);
    }

    #[test]
    fn mirroring_drops_only_what_last_fm_reported_and_no_longer_does() {
        let (_dir, conn) = conn();
        mirror(&conn, &set(&["heard", "unloved-elsewhere"]), &set(&[])).unwrap();
        // Loved here, and autocorrected on the way to last.fm: it comes back
        // under another key and never under this one.
        remember(&conn, &["corrected-here".to_owned()]).unwrap();

        mirror(&conn, &set(&["heard", "Corrected"]), &set(&[])).unwrap();

        assert_eq!(
            keys(&conn),
            vec![
                ("Corrected".to_owned(), true),
                ("corrected-here".to_owned(), false),
                ("heard".to_owned(), true),
            ]
        );
    }

    #[test]
    fn a_pending_change_outlasts_what_last_fm_says() {
        let (_dir, conn) = conn();
        mirror(&conn, &set(&["unloved-here", "kept"]), &set(&[])).unwrap();
        forget(&conn, &["unloved-here".to_owned()]).unwrap();
        remember(&conn, &["loved-here".to_owned()]).unwrap();
        // Neither change has reached last.fm, so its set still says the
        // opposite of both.
        mirror(
            &conn,
            &set(&["unloved-here"]),
            &set(&["unloved-here", "loved-here"]),
        )
        .unwrap();

        assert_eq!(keys(&conn), vec![("loved-here".to_owned(), false)]);
    }

    #[test]
    fn disowning_makes_every_key_local() {
        let (_dir, conn) = conn();
        mirror(&conn, &set(&["a"]), &set(&[])).unwrap();

        disown(&conn).unwrap();

        assert_eq!(local(&conn).unwrap(), vec!["a".to_owned()]);
    }

    #[test]
    fn a_key_is_sent_under_the_present_older_track() {
        let (_dir, conn) = conn();
        track(&conn, 1, "Blue Room", "Harbour");
        track(&conn, 2, "Blue Room", "harbour");
        conn.execute("UPDATE tracks SET missing_since = 1 WHERE id = 1", [])
            .unwrap();
        let key = match_key("Blue Room", "Harbour");

        assert_eq!(
            song(&conn, &key).unwrap(),
            Some(("Blue Room".to_owned(), "harbour".to_owned()))
        );
        assert_eq!(song(&conn, "absent").unwrap(), None);
    }
}
