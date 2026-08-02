//! Reading tracks back out.
//!
//! Every query is paged. Nothing here ever loads the whole library: the table
//! asks for the window it is about to render plus a count for the scrollbar.

use rusqlite::{Connection, Row};

use crate::error::AppResult;
use crate::model::{Track, TrackQuery};

/// Table-qualified: `tracks_fts` carries columns of the same names, so an
/// unqualified list is ambiguous the moment a search joins it in.
pub(crate) const COLUMNS: &str =
    "tracks.id, tracks.path, tracks.duration_ms, tracks.title, tracks.artist, \
                       tracks.album, tracks.album_artist, tracks.genre, tracks.year, \
                       tracks.track_no, tracks.disc_no, tracks.comment, tracks.bitrate, \
                       tracks.sample_rate, tracks.cover_hash, tracks.added_at, \
                       tracks.play_count, tracks.last_played_at";

/// Upper bound on a single page, so a bad `limit` cannot ask for the whole
/// library and blow up the IPC payload.
pub const MAX_LIMIT: u32 = 1_000;

pub(crate) fn row_to_track(row: &Row<'_>) -> rusqlite::Result<Track> {
    Ok(Track {
        id: row.get(0)?,
        path: row.get(1)?,
        duration_ms: row.get(2)?,
        title: row.get(3)?,
        artist: row.get(4)?,
        album: row.get(5)?,
        album_artist: row.get(6)?,
        genre: row.get(7)?,
        year: row.get(8)?,
        track_no: row.get(9)?,
        disc_no: row.get(10)?,
        comment: row.get(11)?,
        bitrate: row.get(12)?,
        sample_rate: row.get(13)?,
        cover_hash: row.get(14)?,
        added_at: row.get(15)?,
        play_count: row.get(16)?,
        last_played_at: row.get(17)?,
    })
}

/// Turns a user's search box contents into an FTS5 prefix query.
///
/// FTS5 has its own operator syntax, so raw input cannot be passed through: a
/// stray `"` or `*` is a syntax error and `AND`/`NEAR` would be interpreted.
/// Each word is quoted (making it a literal) and given a prefix `*` so results
/// narrow as the user types.
///
/// Returns `None` when nothing searchable remains - punctuation-only input
/// tokenizes to nothing, which FTS5 rejects outright - and the caller then
/// treats the query as unfiltered.
fn to_fts_query(search: &str) -> Option<String> {
    let terms: Vec<String> = search
        .split_whitespace()
        .map(|term| term.replace('"', ""))
        // The tokenizer discards punctuation, so a term with no alphanumeric
        // character would become an empty token and error.
        .filter(|term| term.chars().any(char::is_alphanumeric))
        .map(|term| format!("\"{term}\"*"))
        .collect();

    (!terms.is_empty()).then(|| terms.join(" AND "))
}

/// Builds the shared FROM/WHERE, which count and page queries must agree on.
fn from_clause(fts: Option<&String>) -> &'static str {
    if fts.is_some() {
        "FROM tracks JOIN tracks_fts ON tracks_fts.rowid = tracks.id WHERE tracks_fts MATCH ?1"
    } else {
        "FROM tracks"
    }
}

pub fn count_tracks(conn: &Connection, query: &TrackQuery) -> AppResult<u32> {
    let fts = query.search.as_deref().and_then(to_fts_query);
    let sql = format!("SELECT count(*) {}", from_clause(fts.as_ref()));

    let count: i64 = match &fts {
        Some(match_expr) => conn.query_row(&sql, [match_expr], |row| row.get(0))?,
        None => conn.query_row(&sql, [], |row| row.get(0))?,
    };
    Ok(count as u32)
}

pub fn query_tracks(conn: &Connection, query: &TrackQuery) -> AppResult<Vec<Track>> {
    let fts = query.search.as_deref().and_then(to_fts_query);
    let limit = query.limit.min(MAX_LIMIT);

    // `sort_by`/`direction` are enums whose SQL forms are literals, so this
    // interpolation cannot carry caller input. NULLs always sort last so
    // untagged files do not head up every ascending view. `id` breaks ties so
    // paging stays stable when the sort column has duplicates.
    let sort = format!("tracks.{}", query.sort_by.as_sql());
    let sql = format!(
        "SELECT {COLUMNS} {} ORDER BY {sort} IS NULL, {sort} {}, tracks.id {} LIMIT ?{} OFFSET ?{}",
        from_clause(fts.as_ref()),
        query.direction.as_sql(),
        query.direction.as_sql(),
        if fts.is_some() { 2 } else { 1 },
        if fts.is_some() { 3 } else { 2 },
    );

    let mut stmt = conn.prepare(&sql)?;
    let tracks = match &fts {
        Some(match_expr) => stmt
            .query_map(
                rusqlite::params![match_expr, limit, query.offset],
                row_to_track,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?,
        None => stmt
            .query_map(rusqlite::params![limit, query.offset], row_to_track)?
            .collect::<rusqlite::Result<Vec<_>>>()?,
    };

    Ok(tracks)
}

/// Every matching track id, in the query's sort order.
///
/// Backs "select all": selection is a set of ids, so it must not be limited by
/// the page cap that applies to full rows. Ids are cheap enough to send for a
/// whole library where rows would not be.
pub fn all_track_ids(conn: &Connection, query: &TrackQuery) -> AppResult<Vec<i64>> {
    let fts = query.search.as_deref().and_then(to_fts_query);
    let sort = format!("tracks.{}", query.sort_by.as_sql());
    let sql = format!(
        "SELECT tracks.id {} ORDER BY {sort} IS NULL, {sort} {}, tracks.id {}",
        from_clause(fts.as_ref()),
        query.direction.as_sql(),
        query.direction.as_sql(),
    );

    let mut stmt = conn.prepare(&sql)?;
    let ids = match &fts {
        Some(match_expr) => stmt
            .query_map([match_expr], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?,
        None => stmt
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?,
    };
    Ok(ids)
}

/// Cover bytes for the custom protocol handler.
pub fn cover_bytes(conn: &Connection, hash: &str) -> AppResult<Option<(String, Vec<u8>)>> {
    let mut stmt = conn.prepare("SELECT mime, bytes FROM covers WHERE hash = ?1")?;
    let mut rows = stmt.query_map([hash], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.next().transpose()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::model::{SortDirection, SortField};

    fn seeded() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        let rows = [
            ("/m/1.mp3", "Maki", "Guitar", "Tokyo", 2012, 208_000),
            (
                "/m/2.mp3",
                "Sakura Coming",
                "Guitar",
                "Tokyo",
                2012,
                301_000,
            ),
            (
                "/m/3.mp3",
                "Half Gate",
                "Grizzly Bear",
                "Shields",
                2012,
                330_000,
            ),
            (
                "/m/4.mp3",
                "Gun-Shy",
                "Grizzly Bear",
                "Shields",
                2015,
                271_000,
            ),
        ];
        for (path, title, artist, album, year, duration) in rows {
            conn.execute(
                "INSERT INTO tracks (path, mtime, size, duration_ms, title, artist, album,
                                     album_artist, year, added_at)
                 VALUES (?1, 1, 1, ?2, ?3, ?4, ?5, ?4, ?6, 0)",
                rusqlite::params![path, duration, title, artist, album, year],
            )
            .unwrap();
        }
        // An untagged file, to pin down where NULLs sort.
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, added_at) VALUES ('/m/5.mp3', 1, 1, 0)",
            [],
        )
        .unwrap();
        (dir, db)
    }

    #[test]
    fn counts_and_pages_agree() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        let query = TrackQuery::default();

        assert_eq!(count_tracks(&conn, &query).unwrap(), 5);
        assert_eq!(query_tracks(&conn, &query).unwrap().len(), 5);
    }

    #[test]
    fn pages_do_not_overlap_or_skip() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        let page = |offset| {
            query_tracks(
                &conn,
                &TrackQuery {
                    sort_by: SortField::Path,
                    offset,
                    limit: 2,
                    ..Default::default()
                },
            )
            .unwrap()
            .into_iter()
            .map(|t| t.path)
            .collect::<Vec<_>>()
        };

        assert_eq!(page(0), ["/m/1.mp3", "/m/2.mp3"]);
        assert_eq!(page(2), ["/m/3.mp3", "/m/4.mp3"]);
        assert_eq!(page(4), ["/m/5.mp3"]);
    }

    #[test]
    fn untagged_rows_sort_last_in_both_directions() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();

        for direction in [SortDirection::Asc, SortDirection::Desc] {
            let tracks = query_tracks(
                &conn,
                &TrackQuery {
                    sort_by: SortField::Title,
                    direction,
                    ..Default::default()
                },
            )
            .unwrap();
            assert_eq!(
                tracks.last().unwrap().path,
                "/m/5.mp3",
                "untagged row should sort last going {direction:?}"
            );
        }
    }

    #[test]
    fn search_matches_across_columns_and_prefixes() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        let search = |term: &str| {
            let query = TrackQuery {
                search: Some(term.to_owned()),
                ..Default::default()
            };
            let count = count_tracks(&conn, &query).unwrap();
            let rows = query_tracks(&conn, &query).unwrap();
            assert_eq!(
                count as usize,
                rows.len(),
                "count disagreed with the page for {term:?}"
            );
            rows.len()
        };

        assert_eq!(search("Grizzly"), 2, "matches the artist column");
        assert_eq!(search("Shields"), 2, "matches the album column");
        assert_eq!(search("Sak"), 1, "prefix match while typing");
        assert_eq!(search("Grizzly Shields"), 2, "terms combine with AND");
        assert_eq!(search("nonexistent"), 0);
    }

    #[test]
    fn search_input_is_not_interpreted_as_fts_syntax() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();

        // Each of these is an FTS5 operator or syntax error if passed through
        // raw; all must be treated as literal text instead of failing.
        for hostile in [
            "\"",
            "*",
            "AND",
            "NEAR(a b)",
            "a OR b",
            "tracks_fts",
            "^",
            "()",
        ] {
            let query = TrackQuery {
                search: Some(hostile.to_owned()),
                ..Default::default()
            };
            assert!(
                query_tracks(&conn, &query).is_ok(),
                "search {hostile:?} must not produce a SQL/FTS error"
            );
            assert!(
                count_tracks(&conn, &query).is_ok(),
                "count for {hostile:?} must not produce a SQL/FTS error"
            );
        }
    }

    #[test]
    fn punctuation_only_search_falls_back_to_unfiltered() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        let query = TrackQuery {
            search: Some("***".to_owned()),
            ..Default::default()
        };

        assert_eq!(to_fts_query("***"), None);
        assert_eq!(count_tracks(&conn, &query).unwrap(), 5);
    }

    #[test]
    fn operator_words_are_matched_literally_not_interpreted() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        // "a OR b" as an operator would match everything; as literal terms it
        // matches nothing in this fixture.
        let query = TrackQuery {
            search: Some("Guitar OR Grizzly".to_owned()),
            ..Default::default()
        };

        assert_eq!(count_tracks(&conn, &query).unwrap(), 0);
    }

    #[test]
    fn all_track_ids_is_not_subject_to_the_page_cap() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();

        let ids = all_track_ids(
            &conn,
            &TrackQuery {
                limit: 1,
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(ids.len(), 5, "select-all must ignore limit and offset");
    }

    #[test]
    fn all_track_ids_respects_the_search_filter_and_sort_order() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();

        let filtered = all_track_ids(
            &conn,
            &TrackQuery {
                search: Some("Grizzly".to_owned()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            filtered.len(),
            2,
            "select-all must only cover the filtered view"
        );

        let by_path = all_track_ids(
            &conn,
            &TrackQuery {
                sort_by: SortField::Path,
                ..Default::default()
            },
        )
        .unwrap();
        let page = query_tracks(
            &conn,
            &TrackQuery {
                sort_by: SortField::Path,
                limit: 500,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            by_path,
            page.iter().map(|t| t.id).collect::<Vec<_>>(),
            "ids must arrive in the same order as the rows"
        );
    }

    #[test]
    fn limit_is_capped() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        let tracks = query_tracks(
            &conn,
            &TrackQuery {
                limit: u32::MAX,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            tracks.len(),
            5,
            "capping the limit must not change a small result"
        );
    }
}
