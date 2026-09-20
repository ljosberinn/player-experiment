//! The loved set: which songs last.fm holds a love for.
//!
//! Keyed by [`crate::db::plays::match_key`] and nothing else, because loved is
//! a fact about a song rather than about a play or about a file - see schema
//! migration 13. That is also why membership in it can only be read through
//! the play log: no column anywhere carries the key, so `plays.track_id` is
//! the one bridge from a key back to a row in `tracks`.
//!
//! Two writers, and they are not the same act. [`replace`] is the import
//! saying what last.fm holds now; [`remember`] and [`forget`] are the user
//! loving something from in here, before last.fm has been asked.

use rusqlite::Connection;

use crate::error::AppResult;

/// The tracks in the loved set, as a subquery over `tracks.id`.
///
/// Measured at 53 ms over 237,675 plays, which is why no covering index on
/// `plays(match_key, track_id)` was bought for it; see issue 101.
///
/// `track_id IS NOT NULL` sits *inside* the subquery, so the list a `NOT IN`
/// reads can never hold a NULL to swallow the comparison with. That is why
/// this needs none of the `IS NULL OR …` shape every text `IsNot` carries.
pub const MEMBERS: &str = "SELECT track_id FROM plays \
                           WHERE track_id IS NOT NULL \
                           AND match_key IN (SELECT match_key FROM lastfm_loved)";

/// Every library track the set resolves to.
///
/// The whole set rather than a membership test per track: the window holds it
/// as one set and reads it without a round trip, which is what lets a menu
/// built under the pointer say `Love` or `Unlove` without waiting.
pub fn tracks(conn: &Connection) -> AppResult<Vec<i64>> {
    let mut statement = conn.prepare(&format!("SELECT DISTINCT track_id FROM ({MEMBERS})"))?;
    let ids = statement
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<i64>, _>>()?;
    Ok(ids)
}

/// Adds keys to the set, ignoring the ones already in it.
///
/// `OR IGNORE` rather than a check first: `PRIMARY KEY` is the only thing
/// standing between an optimistic write and a duplicate, and loving a song
/// twice is the ordinary way to arrive at one.
pub fn remember(conn: &Connection, keys: &[String]) -> AppResult<()> {
    let mut insert = conn.prepare("INSERT OR IGNORE INTO lastfm_loved (match_key) VALUES (?1)")?;
    for key in keys {
        insert.execute([key])?;
    }
    Ok(())
}

/// Removes keys from the set. Keys it does not hold are not an error.
pub fn forget(conn: &Connection, keys: &[String]) -> AppResult<()> {
    let mut delete = conn.prepare("DELETE FROM lastfm_loved WHERE match_key = ?1")?;
    for key in keys {
        delete.execute([key])?;
    }
    Ok(())
}

/// Replaces the whole set with what an import fetched.
///
/// Wholesale, because unloving happens and a merged set could never forget
/// one. The caller owns the transaction: an import has paged everything before
/// it gets here, so the delete and the inserts must land together or not at
/// all.
pub fn replace(conn: &Connection, keys: &[String]) -> AppResult<()> {
    conn.execute("DELETE FROM lastfm_loved", [])?;
    remember(conn, keys)
}

/// Which of `keys` the set holds, for putting a failed write back exactly as
/// it was.
pub fn held(conn: &Connection, keys: &[String]) -> AppResult<Vec<String>> {
    let mut statement = conn.prepare("SELECT 1 FROM lastfm_loved WHERE match_key = ?1")?;
    let mut held = Vec::new();
    for key in keys {
        if statement.exists([key])? {
            held.push(key.clone());
        }
    }
    Ok(held)
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

    fn keys(conn: &Connection) -> Vec<String> {
        conn.prepare("SELECT match_key FROM lastfm_loved ORDER BY match_key")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap()
    }

    #[test]
    fn loving_the_same_song_twice_leaves_one_row() {
        // The optimistic write is exactly where a duplicate would come from:
        // the set already holds the key from an import, and the user loves the
        // song again from a menu that did not know.
        let (_dir, conn) = conn();
        let key = crate::db::plays::match_key("Nachtmystium", "Every Last Drop");

        remember(&conn, std::slice::from_ref(&key)).unwrap();
        remember(&conn, std::slice::from_ref(&key)).unwrap();

        assert_eq!(keys(&conn), vec![key]);
    }

    #[test]
    fn forgetting_a_key_the_set_never_held_is_not_an_error() {
        let (_dir, conn) = conn();
        forget(&conn, &["absent".to_owned()]).unwrap();
        assert!(keys(&conn).is_empty());
    }

    #[test]
    fn replacing_the_set_drops_what_it_held_before() {
        let (_dir, conn) = conn();
        remember(&conn, &["old".to_owned()]).unwrap();

        replace(&conn, &["new".to_owned()]).unwrap();

        assert_eq!(keys(&conn), vec!["new".to_owned()]);
    }

    #[test]
    fn a_track_is_in_the_set_only_through_a_play_that_resolved() {
        // The two halves of why membership goes through the log: a loved key
        // whose only play never resolved to a file names no track, and a
        // track is named once however many plays of it there are.
        let (_dir, conn) = conn();
        conn.execute(
            "INSERT INTO tracks (id, path, mtime, size, duration_ms, added_at)
             VALUES (7, '/a.mp3', 0, 0, 1000, 0)",
            [],
        )
        .unwrap();
        let heard = crate::db::plays::match_key("Nachtmystium", "Every Last Drop");
        let unresolved = crate::db::plays::match_key("Marathonmann", "Holzwege");
        for (index, (key, track)) in [
            (&heard, Some(7)),
            (&heard, Some(7)),
            (&unresolved, None::<i64>),
        ]
        .into_iter()
        .enumerate()
        {
            conn.execute(
                "INSERT INTO plays (started_at, source, artist, title, match_key, track_id)
                 VALUES (?1, 'lastfm', 'a', 'b', ?2, ?3)",
                rusqlite::params![index as i64, key, track],
            )
            .unwrap();
        }
        remember(&conn, &[heard, unresolved]).unwrap();

        assert_eq!(tracks(&conn).unwrap(), vec![7]);
    }

    #[test]
    fn held_answers_only_for_the_keys_it_was_asked_about() {
        let (_dir, conn) = conn();
        remember(&conn, &["a".to_owned(), "b".to_owned()]).unwrap();

        assert_eq!(
            held(&conn, &["b".to_owned(), "c".to_owned()]).unwrap(),
            vec!["b".to_owned()]
        );
    }
}
