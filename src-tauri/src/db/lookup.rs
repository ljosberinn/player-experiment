//! The `release_lookup` table: what the unattended pass has already been
//! through.
//!
//! Three jobs in one table - the review queue, the pass's resume point, and
//! the guard that stops a second pass re-searching 8,044 releases. No row
//! means never attempted, and nothing here ever clears a row: a pass that
//! re-searched every miss on every launch would be five hours that finds
//! nothing, forever.
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
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Resolved => "resolved",
            Self::Review => "review",
            Self::NotFound => "none",
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
/// library Picard already tagged does not pay five hours again. Returns how
/// many releases it resolved.
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
    /// pay five hours again.
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
}
