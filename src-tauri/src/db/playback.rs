//! Reads and writes that belong to playback rather than to browsing.

use rusqlite::{Connection, OptionalExtension};

use crate::audio::{Command, EngineState, QueueEntry};
use crate::db::query::row_to_track;
use crate::db::settings::{self, ResumePoint};
use crate::error::AppResult;
use crate::model::{PlaybackStatus, PlayerSnapshot, Track};

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
    // One extra lookup per state change - a load, a seek or a stop - rather
    // than a join on the track query, which `COLUMNS` feeds for every paged
    // row in the table as well. The palette is wanted for one track at a time
    // and never for a row in a list.
    let palette = match track.as_ref().and_then(|t| t.cover_hash.as_deref()) {
        Some(hash) => crate::db::covers::palette(conn, hash)?,
        None => None,
    };
    Ok(PlayerSnapshot {
        status: state.status,
        track,
        palette,
        queue_index: state.queue_index,
        queue_len: state.queue_len,
        position_ms: state.position_ms,
        duration_ms: state.duration_ms,
        volume: state.volume,
        muted: state.muted,
        repeat_one: state.repeat_one,
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

/// What the last session left loaded, as the command that puts it back.
///
/// Takes the resume point rather than reading it: a restore that does not load
/// writes nothing back, so a file that has gone is not tried again every
/// launch. One that loads writes it again through [`remember`].
pub fn take_restore(conn: &Connection) -> AppResult<Option<Command>> {
    let resume = settings::resume_point(conn)?;
    settings::remove(conn, settings::RESUME)?;
    let Some((queue, point)) = resume else {
        return Ok(None);
    };

    // Split at the track, so its index still finds it after songs before it
    // have left the library.
    let index = point.index as usize;
    let mut entries = queue_entries(conn, &queue[..index])?;
    let rest = queue_entries(conn, &queue[index..])?;
    if rest.first().map(|entry| entry.track_id) != Some(queue[index]) {
        return Ok(None);
    }
    let index = entries.len();
    entries.extend(rest);
    Ok(Some(Command::Restore {
        entries,
        index,
        position_ms: point.position_ms,
    }))
}

/// Keeps the resume point in step with the engine: where it stands while a
/// track is loaded, and nothing once it stops.
pub fn remember(conn: &Connection, state: &EngineState) -> AppResult<()> {
    match (state.status, state.queue_index) {
        (PlaybackStatus::Stopped, _) | (_, None) => settings::remove(conn, settings::RESUME),
        (_, Some(index)) => settings::save_resume_point(
            conn,
            ResumePoint {
                index,
                position_ms: state.position_ms,
            },
        ),
    }
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

    fn restores(conn: &Connection) -> Option<(Vec<i64>, usize, i64)> {
        take_restore(conn).unwrap().map(|command| match command {
            Command::Restore {
                entries,
                index,
                position_ms,
            } => (
                entries.iter().map(|entry| entry.track_id).collect(),
                index,
                position_ms,
            ),
            other => panic!("not a restore: {other:?}"),
        })
    }

    fn left_at(conn: &Connection, queue: &[i64], index: u32, position_ms: i64) {
        settings::save_queue(conn, queue).unwrap();
        settings::save_resume_point(conn, ResumePoint { index, position_ms }).unwrap();
    }

    #[test]
    fn a_restore_puts_back_the_queue_and_the_place_in_it() {
        let (_dir, conn) = seeded();
        left_at(&conn, &[3, 1, 2], 1, 400);
        assert_eq!(restores(&conn), Some((vec![3, 1, 2], 1, 400)));
    }

    #[test]
    fn a_restore_finds_its_track_after_songs_before_it_have_gone() {
        let (_dir, conn) = seeded();
        left_at(&conn, &[99, 1, 98, 2, 3], 3, 400);
        assert_eq!(restores(&conn), Some((vec![1, 2, 3], 1, 400)));
    }

    #[test]
    fn a_track_that_has_left_the_library_restores_nothing_and_is_forgotten() {
        let (_dir, conn) = seeded();
        left_at(&conn, &[1, 99, 2], 1, 400);

        assert_eq!(restores(&conn), None);
        assert_eq!(settings::get(&conn, settings::RESUME).unwrap(), None);
    }

    #[test]
    fn a_stop_forgets_where_the_player_stood() {
        let (_dir, conn) = seeded();
        let state = EngineState {
            status: PlaybackStatus::Paused,
            track_id: Some(2),
            next_track_id: None,
            queue_index: Some(1),
            queue_len: 2,
            position_ms: 1_500,
            duration_ms: 2_000,
            volume: 1.0,
            muted: false,
            repeat_one: false,
        };
        settings::save_queue(&conn, &[1, 2]).unwrap();

        remember(&conn, &state).unwrap();
        assert_eq!(restores(&conn), Some((vec![1, 2], 1, 1_500)));

        remember(&conn, &state).unwrap();
        let stopped = EngineState {
            status: PlaybackStatus::Stopped,
            ..state
        };
        remember(&conn, &stopped).unwrap();
        assert_eq!(restores(&conn), None);
    }
}
