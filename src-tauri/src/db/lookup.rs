//! The `release_lookup` table: what the unattended pass has already been
//! through.
//!
//! Three jobs in one table - the review queue, the pass's resume point, and
//! the guard that stops a second pass re-searching 8,044 releases. No row
//! means never attempted, and nothing here ever clears a row: a pass that
//! re-searched every miss on every launch would be the best part of a day
//! that finds nothing, forever.
//!
//! Every query keys on `db::query`'s two grouping expressions, folded with
//! `COLLATE NOCASE` the way the browse grid folds them, because a release has
//! to be the same thing here as it is in the grid.

use rusqlite::Connection;

use crate::error::AppResult;

/// The album and artist of a release, as the grid's expressions produce them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Release {
    pub album: Option<String>,
    pub artist: Option<String>,
}

/// What became of a release the pass attempted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// Written, or already carrying the identity before the pass ran.
    Resolved,
    /// Below the threshold: nothing was written, and a person decides.
    Review,
    /// MusicBrainz has nothing. Recorded so it is not searched again, and not
    /// queued - there is nothing for the user to decide.
    NotFound,
    /// Queued, and the user has said to leave it alone. Out of the queue and
    /// out of the count, and only [`restore_aside`] brings it back.
    ///
    /// Skipping in the review dialog means "not now" - the entry stays and is
    /// offered again. This is the other thing skipping could have meant, kept
    /// apart from it because they are different decisions and a queue that can
    /// only say the first is a queue whose count never reaches zero.
    Aside,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Resolved => "resolved",
            Self::Review => "review",
            Self::NotFound => "none",
            Self::Aside => "aside",
        }
    }
}

/// The grid's two grouping expressions, spelled for this table's queries.
///
/// Repeated from `db::query` rather than shared: those are private consts of a
/// module that builds whole statements around them, and making them `pub`
/// would invite a third notion of what a release is. They have to stay in
/// step, which is what `a_release_tagged_two_ways_is_one_pending_release` is
/// for.
const ALBUM: &str = "nullif(tracks.album, '')";
const ARTIST: &str = "coalesce(nullif(tracks.album_artist, ''), nullif(tracks.artist, ''))";

/// Releases with no row, in the order they would be read, at most `limit` of
/// them, skipping the first `offset`.
///
/// Batched rather than one at a time: this groups every row of `tracks`, and
/// re-running it between two releases that each cost two seconds would spend
/// the pass scanning the table eight thousand times.
///
/// **The offset is for the dry run and nothing else.** A real pass records a
/// row per release, so the rows are its cursor and it asks for the first batch
/// every time - which is also what makes it resumable across a quit. A dry run
/// writes no rows and would otherwise survey its first batch over and over,
/// forever, which is the one thing the mode exists not to do.
///
/// `min()` picks each group's label off a `NOCASE` grouping the way
/// `browse_groups` does - a binary comparison, so the same casing every time.
pub fn pending(conn: &Connection, limit: usize, offset: usize) -> AppResult<Vec<Release>> {
    // The grouping is a derived table rather than a `HAVING`, because SQLite
    // refuses an aggregate inside a correlated subquery: the label has to
    // exist as a column before it can be matched against a recorded row.
    let sql = format!(
        "SELECT album, artist
           FROM (SELECT min({ALBUM}) AS album, min({ARTIST}) AS artist
                   FROM tracks
                  WHERE tracks.missing_since IS NULL
                  GROUP BY {ALBUM} COLLATE NOCASE, {ARTIST} COLLATE NOCASE) AS releases
          WHERE NOT EXISTS (
                    SELECT 1 FROM release_lookup
                     WHERE coalesce(release_lookup.album,  '') = coalesce(releases.album,  '') COLLATE NOCASE
                       AND coalesce(release_lookup.artist, '') = coalesce(releases.artist, '') COLLATE NOCASE)
          ORDER BY artist IS NULL, artist COLLATE NOCASE, album IS NULL, album COLLATE NOCASE
          LIMIT ?1 OFFSET ?2"
    );

    let mut stmt = conn.prepare(&sql)?;
    let releases = stmt
        .query_map([limit as i64, offset as i64], |row| {
            Ok(Release {
                album: row.get(0)?,
                artist: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(releases)
}

/// Writes what became of one release, replacing any earlier attempt.
///
/// The conflict target is the expression the unique index is over, which is
/// what makes an untagged release one row rather than one per attempt.
pub fn record(
    conn: &Connection,
    release: &Release,
    status: Status,
    release_mbid: Option<&str>,
    score: Option<f32>,
    candidates_json: Option<&str>,
    now: i64,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO release_lookup
             (album, artist, status, release_mbid, score, candidates_json, attempted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (coalesce(album, '') COLLATE NOCASE, coalesce(artist, '') COLLATE NOCASE)
         DO UPDATE SET status          = excluded.status,
                       release_mbid    = excluded.release_mbid,
                       score           = excluded.score,
                       candidates_json = excluded.candidates_json,
                       attempted_at    = excluded.attempted_at",
        rusqlite::params![
            release.album,
            release.artist,
            status.as_str(),
            release_mbid,
            score,
            candidates_json,
            now,
        ],
    )?;
    Ok(())
}

/// Resolves every release whose files already agree on a release MBID.
///
/// Seeded from the tags `tags::read` keeps, so a re-install or a rescan of a
/// library Picard already tagged does not pay for the whole pass again.
/// Returns how many releases it resolved.
///
/// `count(*) = count(release_mbid)` is "every file carries one" - `count` of a
/// column skips NULLs - and the `count(DISTINCT …) = 1` beside it refuses a
/// release whose files name two different pressings, which is a disagreement
/// the lookup exists to settle rather than one to pick a side of.
///
/// `OR IGNORE` rather than an upsert: a release the pass has already attempted
/// keeps that attempt.
pub fn seed_from_tags(conn: &Connection, now: i64) -> AppResult<usize> {
    let sql = format!(
        "INSERT OR IGNORE INTO release_lookup (album, artist, status, release_mbid, attempted_at)
         SELECT min({ALBUM}), min({ARTIST}), 'resolved', min(tracks.release_mbid), ?1
           FROM tracks
          WHERE tracks.missing_since IS NULL
          GROUP BY {ALBUM} COLLATE NOCASE, {ARTIST} COLLATE NOCASE
         HAVING count(*) = count(tracks.release_mbid)
            AND count(DISTINCT tracks.release_mbid) = 1"
    );
    Ok(conn.execute(&sql, [now])?)
}

/// A queued release, as the review dialog needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Queued {
    pub album: Option<String>,
    pub artist: Option<String>,
    /// Every file of the release, in the order the dialog maps them onto a
    /// tracklist - the same order `query::release_selections` produces.
    pub track_ids: Vec<i64>,
    /// The search results the pass had in hand when it queued this.
    ///
    /// A cache, not a record: it saves the user a rate-limited ten seconds per
    /// entry, and the dialog offers Search Again beside it.
    pub candidates_json: Option<String>,
}

/// A release as [`queue`] matches it in memory: the album and artist, folded.
type Key = (Option<String>, Option<String>);

/// How a release is keyed in memory, folding case the way `NOCASE` does.
fn fold(album: &Option<String>, artist: &Option<String>) -> Key {
    (
        album.as_ref().map(|value| value.to_ascii_lowercase()),
        artist.as_ref().map(|value| value.to_ascii_lowercase()),
    )
}

/// The review queue, and a prune of what is no longer in it.
///
/// One ordered pass over `tracks`, matched in memory against the handful of
/// rows awaiting a decision, rather than a join or a query per queued release.
/// Both of those are the grouping expressions on one side and a small table on
/// the other, which SQLite has no index it can meet in the middle with: 412
/// releases against 65,535 tracks is 27 million comparisons either way round.
///
/// **It prunes as it goes.** Retagging a release changes its key, so the row
/// that queued it is orphaned - it names a release that no longer exists, and
/// it would sit in the count forever. Removing songs from the library does the
/// same. Only rows awaiting a decision are pruned: a resolved or not-found row
/// left behind by a retag is a tombstone, and deleting it would buy nothing but
/// a search the pass has already paid for.
pub fn queue(conn: &Connection) -> AppResult<Vec<Queued>> {
    let mut awaiting = conn
        .prepare(
            "SELECT id, album, artist, status, candidates_json
               FROM release_lookup
              WHERE status IN ('review', 'aside')",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if awaiting.is_empty() {
        return Ok(Vec::new());
    }

    // Which row a scanned release belongs to, and whether anything scanned has
    // claimed it yet. Keyed on the folded pair, which is what the unique index
    // is over.
    let mut by_key = std::collections::HashMap::with_capacity(awaiting.len());
    for (index, (_, album, artist, _, _)) in awaiting.iter().enumerate() {
        by_key.insert(fold(album, artist), index);
    }
    let mut live = vec![false; awaiting.len()];
    let mut queued: Vec<Queued> = Vec::new();

    let sql = format!(
        "SELECT {ALBUM}, {ARTIST}, tracks.id
           FROM tracks
          WHERE tracks.missing_since IS NULL
          ORDER BY {ARTIST} IS NULL, {ARTIST} COLLATE NOCASE,
                   {ALBUM}  IS NULL, {ALBUM}  COLLATE NOCASE,
                   coalesce(tracks.disc_no, 1), tracks.track_no, tracks.path"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([])?;
    // The scan is ordered by the two keys, so a release's files arrive
    // together and the last entry is the only one a row can belong to.
    let mut current: Option<(Key, bool)> = None;
    while let Some(row) = rows.next()? {
        let album: Option<String> = row.get(0)?;
        let artist: Option<String> = row.get(1)?;
        let id: i64 = row.get(2)?;
        let key = fold(&album, &artist);

        let wanted = match &current {
            Some((seen, wanted)) if *seen == key => *wanted,
            _ => {
                let index = by_key.get(&key).copied();
                let wanted = match index {
                    Some(index) => {
                        live[index] = true;
                        awaiting[index].3 == Status::Review.as_str()
                    }
                    None => false,
                };
                if let (true, Some(index)) = (wanted, index) {
                    queued.push(Queued {
                        album: album.clone(),
                        artist: artist.clone(),
                        track_ids: Vec::new(),
                        candidates_json: awaiting[index].4.take(),
                    });
                }
                current = Some((key, wanted));
                wanted
            }
        };
        if wanted {
            if let Some(entry) = queued.last_mut() {
                entry.track_ids.push(id);
            }
        }
    }

    for (index, alive) in live.iter().enumerate() {
        if !alive {
            conn.execute(
                "DELETE FROM release_lookup WHERE id = ?1",
                [awaiting[index].0],
            )?;
        }
    }

    Ok(queued)
}

/// How many releases are waiting for a decision.
///
/// A count over a table of at most one row per release, rather than the
/// grouping [`queue`] does: the sidebar asks this every time the library
/// changes, and the queue itself is opened by a click. It can read one ahead
/// of the queue where a release has been retagged since it was queued, which
/// is what the prune in [`queue`] settles.
pub fn review_count(conn: &Connection) -> AppResult<usize> {
    Ok(conn.query_row(
        "SELECT count(*) FROM release_lookup WHERE status = 'review'",
        [],
        |row| row.get::<_, i64>(0),
    )? as usize)
}

/// How many releases have been set aside, which is the size of the way back.
pub fn aside_count(conn: &Connection) -> AppResult<usize> {
    Ok(conn.query_row(
        "SELECT count(*) FROM release_lookup WHERE status = 'aside'",
        [],
        |row| row.get::<_, i64>(0),
    )? as usize)
}

/// Takes one release out of the queue until somebody asks for it back.
///
/// Only from `review`: the point is to make a decision about a queued release,
/// and setting aside one the pass has since resolved would put a resolved
/// release back in a queue it has left.
pub fn set_aside(conn: &Connection, release: &Release) -> AppResult<()> {
    conn.execute(
        "UPDATE release_lookup
            SET status = 'aside'
          WHERE status = 'review'
            AND coalesce(album,  '') = coalesce(?1, '') COLLATE NOCASE
            AND coalesce(artist, '') = coalesce(?2, '') COLLATE NOCASE",
        rusqlite::params![release.album, release.artist],
    )?;
    Ok(())
}

/// Puts every set-aside release back in the queue, and says how many.
///
/// All of them at once, because that is the whole way back: a per-release list
/// of things the user has said they do not want to look at is a second queue,
/// and the one thing it needs to be is not a trap.
pub fn restore_aside(conn: &Connection) -> AppResult<usize> {
    Ok(conn.execute(
        "UPDATE release_lookup SET status = 'review' WHERE status = 'aside'",
        [],
    )?)
}

/// How far the pass has got: releases with a row, and releases in the library.
///
/// Two group-bys over every track, which is why the worker asks once a sweep
/// and counts the rest itself.
pub fn progress(conn: &Connection) -> AppResult<(usize, usize)> {
    // The grouping is a derived table for the same reason `pending`'s is:
    // SQLite refuses an aggregate inside a correlated subquery, so the label
    // has to be a column before a row can be matched against it.
    let sql = format!(
        "SELECT count(*), sum(attempted)
           FROM (SELECT EXISTS (
                            SELECT 1 FROM release_lookup
                             WHERE coalesce(release_lookup.album,  '') = coalesce(releases.album,  '') COLLATE NOCASE
                               AND coalesce(release_lookup.artist, '') = coalesce(releases.artist, '') COLLATE NOCASE
                        ) AS attempted
                   FROM (SELECT min({ALBUM}) AS album, min({ARTIST}) AS artist
                           FROM tracks
                          WHERE tracks.missing_since IS NULL
                          GROUP BY {ALBUM} COLLATE NOCASE, {ARTIST} COLLATE NOCASE) AS releases) AS counted"
    );
    let (total, done) = conn.query_row(&sql, [], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?))
    })?;
    Ok((done.unwrap_or(0) as usize, total as usize))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn open() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    fn track(conn: &Connection, path: &str, album: &str, artist: &str, mbid: Option<&str>) {
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, album, album_artist, artist, release_mbid, added_at)
             VALUES (?1, 0, 0, ?2, ?3, ?3, ?4, 0)",
            rusqlite::params![path, album, artist, mbid],
        )
        .unwrap();
    }

    fn keys(releases: &[Release]) -> Vec<(Option<&str>, Option<&str>)> {
        releases
            .iter()
            .map(|release| (release.album.as_deref(), release.artist.as_deref()))
            .collect()
    }

    #[test]
    fn a_library_with_no_rows_is_all_pending() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        track(&conn, "b.mp3", "Loveless", "My Bloody Valentine", None);
        track(
            &conn,
            "c.mp3",
            "Isn't Anything",
            "My Bloody Valentine",
            None,
        );

        assert_eq!(
            keys(&pending(&conn, 10, 0).unwrap()),
            [
                (Some("Isn't Anything"), Some("My Bloody Valentine")),
                (Some("Loveless"), Some("My Bloody Valentine")),
            ]
        );
    }

    /// The dry run's cursor. It writes no rows, so the offset is the only
    /// thing that gets it past the batch it has already surveyed.
    #[test]
    fn an_offset_pages_past_the_releases_already_read() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        track(
            &conn,
            "b.mp3",
            "Isn't Anything",
            "My Bloody Valentine",
            None,
        );

        assert_eq!(
            keys(&pending(&conn, 1, 0).unwrap()),
            [(Some("Isn't Anything"), Some("My Bloody Valentine"))]
        );
        assert_eq!(
            keys(&pending(&conn, 1, 1).unwrap()),
            [(Some("Loveless"), Some("My Bloody Valentine"))]
        );
        assert!(pending(&conn, 1, 2).unwrap().is_empty());
    }

    /// The idempotence guard: a second pass over a library it has been through
    /// has nothing to do, whatever the outcome was the first time.
    #[test]
    fn a_release_with_a_row_is_not_pending_again() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        let release = pending(&conn, 10, 0).unwrap().remove(0);

        record(&conn, &release, Status::NotFound, None, None, None, 100).unwrap();

        assert!(pending(&conn, 10, 0).unwrap().is_empty());
    }

    #[test]
    fn a_release_tagged_two_ways_is_one_pending_release() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        track(&conn, "b.mp3", "loveless", "my bloody valentine", None);

        assert_eq!(pending(&conn, 10, 0).unwrap().len(), 1);
    }

    #[test]
    fn an_untagged_release_is_pending_and_recordable() {
        let (_dir, conn) = open();
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, added_at) VALUES ('a.mp3', 0, 0, 0)",
            [],
        )
        .unwrap();

        let releases = pending(&conn, 10, 0).unwrap();
        assert_eq!(keys(&releases), [(None, None)]);

        record(&conn, &releases[0], Status::NotFound, None, None, None, 100).unwrap();
        assert!(pending(&conn, 10, 0).unwrap().is_empty());
    }

    /// Retagging invalidates by itself: the key changes, so the release reads
    /// as unattempted and gets looked up again.
    #[test]
    fn retagging_a_release_makes_it_pending_again() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Lovless", "My Bloody Valentine", None);
        let release = pending(&conn, 10, 0).unwrap().remove(0);
        record(&conn, &release, Status::Review, None, Some(0.4), None, 100).unwrap();

        conn.execute("UPDATE tracks SET album = 'Loveless'", [])
            .unwrap();

        assert_eq!(
            keys(&pending(&conn, 10, 0).unwrap()),
            [(Some("Loveless"), Some("My Bloody Valentine"))]
        );
    }

    #[test]
    fn recording_the_same_release_twice_updates_rather_than_fails() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        let release = pending(&conn, 10, 0).unwrap().remove(0);

        record(
            &conn,
            &release,
            Status::Review,
            None,
            Some(0.4),
            Some("[]"),
            100,
        )
        .unwrap();
        record(
            &conn,
            &release,
            Status::Resolved,
            Some("bb5a"),
            Some(0.99),
            None,
            200,
        )
        .unwrap();

        let (status, mbid, attempted): (String, Option<String>, i64) = conn
            .query_row(
                "SELECT status, release_mbid, attempted_at FROM release_lookup",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (status.as_str(), mbid.as_deref(), attempted),
            ("resolved", Some("bb5a"), 200)
        );
    }

    /// A re-install or a rescan of a library Picard already tagged must not
    /// pay for the whole pass again.
    #[test]
    fn a_release_whose_files_all_carry_an_mbid_is_resolved_without_a_call() {
        let (_dir, conn) = open();
        track(
            &conn,
            "a.mp3",
            "Loveless",
            "My Bloody Valentine",
            Some("bb5a"),
        );
        track(
            &conn,
            "b.mp3",
            "Loveless",
            "My Bloody Valentine",
            Some("bb5a"),
        );

        assert_eq!(seed_from_tags(&conn, 100).unwrap(), 1);
        assert!(pending(&conn, 10, 0).unwrap().is_empty());
        assert_eq!(
            conn.query_row(
                "SELECT status, release_mbid FROM release_lookup",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            )
            .unwrap(),
            ("resolved".to_owned(), "bb5a".to_owned())
        );
    }

    #[test]
    fn a_release_only_half_of_which_carries_an_mbid_is_still_pending() {
        let (_dir, conn) = open();
        track(
            &conn,
            "a.mp3",
            "Loveless",
            "My Bloody Valentine",
            Some("bb5a"),
        );
        track(&conn, "b.mp3", "Loveless", "My Bloody Valentine", None);

        assert_eq!(seed_from_tags(&conn, 100).unwrap(), 0);
        assert_eq!(pending(&conn, 10, 0).unwrap().len(), 1);
    }

    /// Files disagreeing about which pressing they are is exactly what the
    /// lookup is for, so the seed leaves it alone rather than picking one.
    #[test]
    fn a_release_whose_files_name_two_different_pressings_is_still_pending() {
        let (_dir, conn) = open();
        track(
            &conn,
            "a.mp3",
            "Loveless",
            "My Bloody Valentine",
            Some("bb5a"),
        );
        track(
            &conn,
            "b.mp3",
            "Loveless",
            "My Bloody Valentine",
            Some("cc5a"),
        );

        assert_eq!(seed_from_tags(&conn, 100).unwrap(), 0);
        assert_eq!(pending(&conn, 10, 0).unwrap().len(), 1);
    }

    #[test]
    fn seeding_twice_is_a_no_op() {
        let (_dir, conn) = open();
        track(
            &conn,
            "a.mp3",
            "Loveless",
            "My Bloody Valentine",
            Some("bb5a"),
        );

        assert_eq!(seed_from_tags(&conn, 100).unwrap(), 1);
        assert_eq!(seed_from_tags(&conn, 200).unwrap(), 0);
    }

    /// A file that cannot be read cannot be written either, so counting it
    /// would hold a release back over a drive that is not plugged in.
    #[test]
    fn a_missing_file_does_not_hold_its_release_back() {
        let (_dir, conn) = open();
        track(
            &conn,
            "a.mp3",
            "Loveless",
            "My Bloody Valentine",
            Some("bb5a"),
        );
        track(&conn, "b.mp3", "Loveless", "My Bloody Valentine", None);
        conn.execute(
            "UPDATE tracks SET missing_since = 1 WHERE path = 'b.mp3'",
            [],
        )
        .unwrap();

        assert_eq!(seed_from_tags(&conn, 100).unwrap(), 1);
    }

    /// Queues `album`/`artist` for review, carrying `candidates` as the cache
    /// 82c's dialog opens on.
    fn queue_for_review(conn: &Connection, album: &str, artist: &str, candidates: &str) {
        record(
            conn,
            &Release {
                album: Some(album.to_owned()),
                artist: Some(artist.to_owned()),
            },
            Status::Review,
            None,
            Some(0.4),
            Some(candidates),
            100,
        )
        .unwrap();
    }

    #[test]
    fn the_queue_carries_every_file_of_a_release_and_its_cached_candidates() {
        let (_dir, conn) = open();
        track(&conn, "b.mp3", "Loveless", "My Bloody Valentine", None);
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        track(
            &conn,
            "c.mp3",
            "Isn't Anything",
            "My Bloody Valentine",
            None,
        );
        queue_for_review(
            &conn,
            "Loveless",
            "My Bloody Valentine",
            "[{\"mbid\":\"x\"}]",
        );

        let queued = queue(&conn).unwrap();

        assert_eq!(queued.len(), 1, "only the queued release is offered");
        assert_eq!(queued[0].album.as_deref(), Some("Loveless"));
        assert_eq!(queued[0].track_ids.len(), 2);
        assert_eq!(
            queued[0].candidates_json.as_deref(),
            Some("[{\"mbid\":\"x\"}]")
        );
    }

    /// The grid folds case, so a release tagged two ways is one release here
    /// too - and its files come back whole rather than half of them.
    #[test]
    fn a_release_tagged_two_ways_is_one_queue_entry() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        track(&conn, "b.mp3", "loveless", "my bloody valentine", None);
        queue_for_review(&conn, "Loveless", "My Bloody Valentine", "[]");

        let queued = queue(&conn).unwrap();

        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].track_ids.len(), 2);
    }

    /// Retagging changes the key, so the row that queued a release names one
    /// that no longer exists. Left alone it would sit in the count forever.
    #[test]
    fn a_queued_release_that_was_retagged_is_pruned() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Lovless", "My Bloody Valentine", None);
        queue_for_review(&conn, "Lovless", "My Bloody Valentine", "[]");
        conn.execute("UPDATE tracks SET album = 'Loveless'", [])
            .unwrap();

        assert!(queue(&conn).unwrap().is_empty());
        assert_eq!(review_count(&conn).unwrap(), 0, "the row went with it");
    }

    /// A retag also leaves a resolved row behind, and that one is a tombstone
    /// worth keeping: deleting it buys nothing but a search already paid for.
    #[test]
    fn a_resolved_row_for_a_release_that_moved_is_left_alone() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Lovless", "My Bloody Valentine", None);
        let release = pending(&conn, 10, 0).unwrap().remove(0);
        record(
            &conn,
            &release,
            Status::Resolved,
            Some("bb5a"),
            None,
            None,
            100,
        )
        .unwrap();
        conn.execute("UPDATE tracks SET album = 'Loveless'", [])
            .unwrap();

        queue(&conn).unwrap();

        assert_eq!(
            conn.query_row("SELECT count(*) FROM release_lookup", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn a_release_set_aside_leaves_the_queue_and_the_count_until_it_is_asked_for() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        queue_for_review(&conn, "Loveless", "My Bloody Valentine", "[]");
        let release = Release {
            album: Some("Loveless".to_owned()),
            artist: Some("My Bloody Valentine".to_owned()),
        };

        set_aside(&conn, &release).unwrap();
        assert_eq!(review_count(&conn).unwrap(), 0);
        assert_eq!(aside_count(&conn).unwrap(), 1);
        assert!(queue(&conn).unwrap().is_empty());

        assert_eq!(restore_aside(&conn).unwrap(), 1);
        assert_eq!(review_count(&conn).unwrap(), 1);
        assert_eq!(queue(&conn).unwrap().len(), 1);
    }

    /// The way back has to survive the prune, or setting a release aside and
    /// opening the queue once would be the trap it exists not to be.
    #[test]
    fn opening_the_queue_does_not_prune_a_release_that_was_set_aside() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        queue_for_review(&conn, "Loveless", "My Bloody Valentine", "[]");
        set_aside(
            &conn,
            &Release {
                album: Some("Loveless".to_owned()),
                artist: Some("My Bloody Valentine".to_owned()),
            },
        )
        .unwrap();

        queue(&conn).unwrap();

        assert_eq!(aside_count(&conn).unwrap(), 1);
    }

    /// Setting aside is a decision about a queued release. One the pass has
    /// since resolved has left the queue, and must not be pushed back into it.
    #[test]
    fn setting_aside_a_resolved_release_does_nothing() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        let release = pending(&conn, 10, 0).unwrap().remove(0);
        record(
            &conn,
            &release,
            Status::Resolved,
            Some("bb5a"),
            None,
            None,
            100,
        )
        .unwrap();

        set_aside(&conn, &release).unwrap();

        assert_eq!(aside_count(&conn).unwrap(), 0);
    }

    #[test]
    fn progress_counts_releases_with_a_row_against_every_release() {
        let (_dir, conn) = open();
        track(&conn, "a.mp3", "Loveless", "My Bloody Valentine", None);
        track(
            &conn,
            "b.mp3",
            "Isn't Anything",
            "My Bloody Valentine",
            None,
        );
        track(&conn, "c.mp3", "Spiderland", "Slint", None);

        assert_eq!(progress(&conn).unwrap(), (0, 3));

        let release = pending(&conn, 1, 0).unwrap().remove(0);
        record(&conn, &release, Status::NotFound, None, None, None, 100).unwrap();

        assert_eq!(progress(&conn).unwrap(), (1, 3));
    }

    #[test]
    fn an_empty_library_is_no_progress_rather_than_a_null() {
        let (_dir, conn) = open();
        assert_eq!(progress(&conn).unwrap(), (0, 0));
    }
}
