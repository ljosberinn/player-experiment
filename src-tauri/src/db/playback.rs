//! Reads and writes that belong to playback rather than to browsing.

use rusqlite::{Connection, OptionalExtension};

use crate::audio::{EngineState, QueueEntry};
use crate::db::query::row_to_track;
use crate::error::AppResult;
use crate::model::{PlayerSnapshot, Track};

/// Fills in the track row the engine only knows by id.
///
/// A track that has been removed from the library since it started playing
/// leaves the snapshot's `track` empty rather than failing the whole thing -
/// the transport still has to render.
pub fn snapshot(conn: &Connection, state: &EngineState) -> AppResult<PlayerSnapshot> {
    let track = match state.track_id {
        Some(id) => track_by_id(conn, id)?,
        None => None,
    };
    Ok(PlayerSnapshot {
        status: state.status,
        track,
        queue_index: state.queue_index,
        queue_len: state.queue_len,
        position_ms: state.position_ms,
        duration_ms: state.duration_ms,
        volume: state.volume,
    })
}

pub fn track_by_id(conn: &Connection, id: i64) -> AppResult<Option<Track>> {
    let sql = format!(
        "SELECT {} FROM tracks WHERE tracks.id = ?1",
        crate::db::query::COLUMNS
    );
    Ok(conn.query_row(&sql, [id], row_to_track).optional()?)
}

/// Loads the rows behind a set of ids, skipping any the library no longer has.
///
/// Order follows the caller's list, so an editor showing "3 tracks selected"
/// lists them the way the table did.
pub fn tracks_by_ids(conn: &Connection, ids: &[i64]) -> AppResult<Vec<Track>> {
    let mut found = Vec::with_capacity(ids.len());
    for &id in ids {
        if let Some(track) = track_by_id(conn, id)? {
            found.push(track);
        }
    }
    Ok(found)
}

/// Turns a list of track ids into queue entries, preserving the caller's order.
///
/// Ids the library no longer has are dropped rather than erroring: a queue
/// assembled a moment before a rescan should still play what survives.
pub fn queue_entries(conn: &Connection, ids: &[i64]) -> AppResult<Vec<QueueEntry>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    // One statement reused across ids rather than a giant `IN (...)`: the
    // caller's order has to be preserved anyway, and SQLite caps how many
    // parameters a statement may bind well below a library-sized selection.
    let mut stmt = conn.prepare("SELECT path, duration_ms FROM tracks WHERE id = ?1")?;
    let mut entries = Vec::with_capacity(ids.len());
    for &track_id in ids {
        let found = stmt
            .query_row([track_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .optional()?;
        if let Some((path, duration_ms)) = found {
            entries.push(QueueEntry {
                track_id,
                path,
                duration_ms,
            });
        }
    }
    Ok(entries)
}

/// Records that a track was played.
pub fn mark_played(conn: &Connection, track_id: i64, at: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE tracks SET play_count = play_count + 1, last_played_at = ?2 WHERE id = ?1",
        [track_id, at],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn seeded() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        for id in 1..=3i64 {
            conn.execute(
                "INSERT INTO tracks (id, path, mtime, size, duration_ms, title, added_at)
                 VALUES (?1, ?2, 0, 0, ?3, ?4, 0)",
                rusqlite::params![
                    id,
                    format!("C:\\music\\{id}.mp3"),
                    id * 1000,
                    format!("Track {id}")
                ],
            )
            .unwrap();
        }
        (dir, conn)
    }

    #[test]
    fn finds_a_track_by_id_and_reports_a_missing_one_as_none() {
        let (_dir, conn) = seeded();
        assert_eq!(
            track_by_id(&conn, 2).unwrap().map(|t| t.title),
            Some(Some("Track 2".to_owned()))
        );
        assert!(track_by_id(&conn, 99).unwrap().is_none());
    }

    #[test]
    fn queue_entries_keep_the_order_they_were_asked_for() {
        let (_dir, conn) = seeded();
        let entries = queue_entries(&conn, &[3, 1, 2]).unwrap();
        assert_eq!(
            entries.iter().map(|e| e.track_id).collect::<Vec<_>>(),
            vec![3, 1, 2]
        );
        assert_eq!(entries[0].duration_ms, 3000);
    }

    #[test]
    fn queue_entries_skip_ids_the_library_no_longer_has() {
        let (_dir, conn) = seeded();
        let entries = queue_entries(&conn, &[1, 99, 2]).unwrap();
        assert_eq!(
            entries.iter().map(|e| e.track_id).collect::<Vec<_>>(),
            vec![1, 2]
        );
    }

    #[test]
    fn an_empty_queue_needs_no_query() {
        let (_dir, conn) = seeded();
        assert!(queue_entries(&conn, &[]).unwrap().is_empty());
    }

    #[test]
    fn marking_a_play_increments_the_count_and_stamps_the_time() {
        let (_dir, conn) = seeded();
        mark_played(&conn, 1, 1_700_000_000).unwrap();
        mark_played(&conn, 1, 1_700_000_100).unwrap();

        let track = track_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(track.play_count, 2);
        assert_eq!(track.last_played_at, Some(1_700_000_100));

        // Untouched tracks stay untouched.
        assert_eq!(track_by_id(&conn, 2).unwrap().unwrap().play_count, 0);
    }
}
