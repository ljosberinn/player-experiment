//! Plays waiting to reach last.fm.
//!
//! A scrobble is worth keeping: it describes something that happened, and a
//! laptop closed on a train should not cost the user their listening history.
//! So a play is written here first and sent afterwards, and a failure leaves
//! the row where it is.
//!
//! **What is not kept forever**: last.fm rejects a play more than two weeks old
//! (ignore code 3), so a row past that is dropped rather than retried into a
//! guaranteed rejection - and a row that has failed a dozen times is failing
//! for a reason time will not fix.

use rusqlite::{params, Connection};

use crate::error::AppResult;

use super::rules::Scrobble;

/// How long to wait before trying a deferred scrobble again, by attempt count.
///
/// The last entry repeats. Rising rather than fixed because the two things
/// being waited out are of very different lengths: a lost connection comes back
/// in seconds, and a rate limit or an outage in hours.
const BACKOFF_SECONDS: [i64; 5] = [60, 300, 1_800, 7_200, 21_600];

/// After this many attempts a scrobble is dropped rather than kept.
///
/// A backstop for a failure that time does not fix but that this build cannot
/// classify - the age limit below is the rule that normally applies first.
const MAX_ATTEMPTS: i64 = 12;

/// Older than this and last.fm will not take it, so nor will the queue.
///
/// `ignoredMessage` code 3 is "timestamp too old"; the documented window is two
/// weeks. Keeping a row past it means retrying into a guaranteed rejection
/// forever.
const MAX_AGE_SECONDS: i64 = 14 * 24 * 60 * 60;

/// One queued play, and the row it lives in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Queued {
    pub id: i64,
    pub scrobble: Scrobble,
}

/// Adds a play, and prunes anything too old to be accepted.
///
/// Pruning here rather than on a timer: this is the one moment the queue is
/// known to be growing, it costs one indexed delete, and a queue is only ever
/// large on a machine that has been offline - which is also a machine that has
/// been playing music.
pub fn enqueue(conn: &Connection, scrobble: &Scrobble, now: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO scrobble_queue (artist, title, album, duration_ms, started_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            scrobble.artist,
            scrobble.title,
            scrobble.album,
            scrobble.duration_ms,
            scrobble.started_at,
        ],
    )?;
    prune(conn, now)?;
    Ok(())
}

/// Drops what last.fm would refuse anyway.
pub fn prune(conn: &Connection, now: i64) -> AppResult<u32> {
    let dropped = conn.execute(
        "DELETE FROM scrobble_queue WHERE started_at < ?1 OR attempts >= ?2",
        params![now - MAX_AGE_SECONDS, MAX_ATTEMPTS],
    )?;
    Ok(dropped as u32)
}

/// The next batch to send: oldest first, nothing deferred past `now`.
///
/// Capped at `limit`, which is last.fm's fifty. Ordered by `started_at` rather
/// than by `id` so a batch reads as a listening session even if rows were
/// deferred out of order.
pub fn due(conn: &Connection, now: i64, limit: usize) -> AppResult<Vec<Queued>> {
    let mut stmt = conn.prepare(
        "SELECT id, artist, title, album, duration_ms, started_at
           FROM scrobble_queue
          WHERE next_try_at <= ?1
       ORDER BY started_at, id
          LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![now, limit as i64], |row| {
            Ok(Queued {
                id: row.get(0)?,
                scrobble: Scrobble {
                    artist: row.get(1)?,
                    title: row.get(2)?,
                    album: row.get(3)?,
                    duration_ms: row.get(4)?,
                    started_at: row.get(5)?,
                },
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Forgets rows that are finished with, whether they were taken or refused.
///
/// Both, and deliberately: a scrobble last.fm rejected for a bad artist or an
/// impossible timestamp is as final as one it accepted, and keeping it would
/// mean resending it until the age limit dropped it.
pub fn forget(conn: &Connection, ids: &[i64]) -> AppResult<()> {
    for id in ids {
        conn.execute("DELETE FROM scrobble_queue WHERE id = ?1", [id])?;
    }
    Ok(())
}

/// Puts rows back for later, further out each time.
pub fn defer(conn: &Connection, ids: &[i64], now: i64) -> AppResult<()> {
    for id in ids {
        // Read the count back rather than computing the delay in SQL: the
        // schedule is a Rust constant, and duplicating it in a CASE expression
        // would be two places to keep in step.
        let attempts: i64 = conn.query_row(
            "SELECT attempts FROM scrobble_queue WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;
        conn.execute(
            "UPDATE scrobble_queue SET attempts = ?2, next_try_at = ?3 WHERE id = ?1",
            params![id, attempts + 1, now + backoff(attempts)],
        )?;
    }
    prune(conn, now)?;
    Ok(())
}

/// How long after `attempts` failures to wait.
fn backoff(attempts: i64) -> i64 {
    let index = usize::try_from(attempts).unwrap_or(0);
    BACKOFF_SECONDS[index.min(BACKOFF_SECONDS.len() - 1)]
}

/// How many plays are waiting, deferred ones included.
///
/// What the settings pane shows. Deferred rows count: from the user's side a
/// play that has not reached last.fm is waiting, whether or not this build
/// intends to try again in the next minute.
pub fn depth(conn: &Connection) -> AppResult<u32> {
    let count: i64 = conn.query_row("SELECT count(*) FROM scrobble_queue", [], |row| row.get(0))?;
    Ok(count as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::lastfm::BATCH_LIMIT;

    const NOW: i64 = 1_700_000_000;

    fn conn() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    fn play(started_at: i64) -> Scrobble {
        Scrobble {
            artist: "Blue Room".to_owned(),
            title: format!("Harbour {started_at}"),
            album: Some("Coastline".to_owned()),
            duration_ms: 240_000,
            started_at,
        }
    }

    #[test]
    fn a_queued_play_comes_back_exactly_as_it_went_in() {
        let (_dir, conn) = conn();
        enqueue(&conn, &play(NOW), NOW).unwrap();

        let batch = due(&conn, NOW, BATCH_LIMIT).unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].scrobble, play(NOW));
        assert_eq!(depth(&conn).unwrap(), 1);
    }

    #[test]
    fn a_play_with_no_album_round_trips_as_one() {
        let (_dir, conn) = conn();
        let scrobble = Scrobble {
            album: None,
            ..play(NOW)
        };
        enqueue(&conn, &scrobble, NOW).unwrap();

        assert_eq!(due(&conn, NOW, BATCH_LIMIT).unwrap()[0].scrobble, scrobble);
    }

    #[test]
    fn a_batch_is_capped_and_oldest_first() {
        let (_dir, conn) = conn();
        // Inserted newest first, so the order coming out is the query's doing
        // rather than the insertion's.
        for offset in (0..60).rev() {
            enqueue(&conn, &play(NOW - offset), NOW).unwrap();
        }

        let batch = due(&conn, NOW, BATCH_LIMIT).unwrap();
        assert_eq!(batch.len(), BATCH_LIMIT);
        assert_eq!(batch[0].scrobble.started_at, NOW - 59);
        assert_eq!(batch[BATCH_LIMIT - 1].scrobble.started_at, NOW - 10);
        assert_eq!(depth(&conn).unwrap(), 60);
    }

    #[test]
    fn forgetting_takes_only_the_rows_it_was_given() {
        // The partly-accepted batch, in queue terms: last.fm took one and
        // refused the other for the day, so one row goes and one stays.
        let (_dir, conn) = conn();
        enqueue(&conn, &play(NOW - 2), NOW).unwrap();
        enqueue(&conn, &play(NOW - 1), NOW).unwrap();
        let batch = due(&conn, NOW, BATCH_LIMIT).unwrap();

        forget(&conn, &[batch[0].id]).unwrap();

        let left = due(&conn, NOW, BATCH_LIMIT).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].scrobble.started_at, NOW - 1);
    }

    #[test]
    fn a_deferred_row_is_not_due_until_its_backoff_has_passed() {
        let (_dir, conn) = conn();
        enqueue(&conn, &play(NOW), NOW).unwrap();
        let batch = due(&conn, NOW, BATCH_LIMIT).unwrap();

        defer(&conn, &[batch[0].id], NOW).unwrap();

        assert!(due(&conn, NOW, BATCH_LIMIT).unwrap().is_empty());
        assert!(due(&conn, NOW + 59, BATCH_LIMIT).unwrap().is_empty());
        assert_eq!(due(&conn, NOW + 60, BATCH_LIMIT).unwrap().len(), 1);
        // Still waiting, from the user's side.
        assert_eq!(depth(&conn).unwrap(), 1);
    }

    #[test]
    fn each_failure_waits_longer_than_the_last() {
        let (_dir, conn) = conn();
        enqueue(&conn, &play(NOW), NOW).unwrap();
        let id = due(&conn, NOW, BATCH_LIMIT).unwrap()[0].id;

        let mut at = NOW;
        for expected in BACKOFF_SECONDS {
            defer(&conn, &[id], at).unwrap();
            assert!(due(&conn, at + expected - 1, BATCH_LIMIT)
                .unwrap()
                .is_empty());
            at += expected;
            assert_eq!(due(&conn, at, BATCH_LIMIT).unwrap().len(), 1);
        }

        // And the last delay repeats rather than growing without bound.
        defer(&conn, &[id], at).unwrap();
        let last = BACKOFF_SECONDS[BACKOFF_SECONDS.len() - 1];
        assert_eq!(due(&conn, at + last, BATCH_LIMIT).unwrap().len(), 1);
    }

    #[test]
    fn a_row_that_keeps_failing_is_dropped_rather_than_retried_forever() {
        let (_dir, conn) = conn();
        enqueue(&conn, &play(NOW), NOW).unwrap();
        let id = due(&conn, NOW, BATCH_LIMIT).unwrap()[0].id;

        let mut at = NOW;
        for _ in 0..MAX_ATTEMPTS {
            defer(&conn, &[id], at).unwrap();
            at += BACKOFF_SECONDS[BACKOFF_SECONDS.len() - 1];
        }

        assert_eq!(depth(&conn).unwrap(), 0);
    }

    #[test]
    fn a_play_older_than_last_fm_will_take_is_dropped() {
        // Two weeks is the documented window, past which the play comes back
        // as ignore code 3 - so keeping it means retrying into a guaranteed
        // rejection.
        let (_dir, conn) = conn();
        enqueue(&conn, &play(NOW - MAX_AGE_SECONDS - 1), NOW).unwrap();
        enqueue(&conn, &play(NOW - MAX_AGE_SECONDS + 60), NOW).unwrap();

        assert_eq!(depth(&conn).unwrap(), 1);
        assert_eq!(
            due(&conn, NOW, BATCH_LIMIT).unwrap()[0].scrobble.started_at,
            NOW - MAX_AGE_SECONDS + 60
        );
    }

    #[test]
    fn an_empty_queue_has_nothing_due_and_no_depth() {
        let (_dir, conn) = conn();
        assert!(due(&conn, NOW, BATCH_LIMIT).unwrap().is_empty());
        assert_eq!(depth(&conn).unwrap(), 0);
        // And pruning it is not an error.
        assert_eq!(prune(&conn, NOW).unwrap(), 0);
    }
}
