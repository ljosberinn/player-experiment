//! Reading tracks back out.
//!
//! Every query is paged. Nothing here ever loads the whole library: the table
//! asks for the window it is about to render plus a count for the scrollbar.

use rusqlite::{Connection, Row};

use crate::error::AppResult;
use crate::model::{LibraryStats, PlaylistKind, SortField, Track, TrackQuery};

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

/// What restricts a query: the FROM/WHERE the count and the page must agree
/// on, its bind values, and which optional clauses ended up in it.
struct Scope {
    from_where: String,
    params: Vec<Box<dyn rusqlite::ToSql>>,
    searching: bool,
    in_playlist: bool,
}

/// Builds the shared FROM/WHERE.
///
/// Placeholders are anonymous `?` bound in textual order, so a clause can be
/// added or dropped without renumbering the ones around it.
///
/// Takes a connection because a playlist id alone does not say what it means:
/// a static playlist is a join on its membership, a smart one is its compiled
/// filter. Resolving it here rather than in the caller keeps every query - page,
/// count and id list - agreeing about what the view contains.
fn scope(conn: &Connection, query: &TrackQuery) -> AppResult<Scope> {
    let fts = query.search.as_deref().and_then(to_fts_query);
    let mut from_where = String::from("FROM tracks");
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    let mut conditions: Vec<String> = Vec::new();
    let mut in_playlist = false;

    if let Some(playlist_id) = query.playlist_id {
        match crate::db::playlists::get(conn, playlist_id)? {
            // A playlist deleted from under an open view is an empty view
            // rather than an error: the sidebar is about to drop it anyway.
            None => conditions.push("1 = 0".to_owned()),
            Some(playlist) if playlist.kind == PlaylistKind::Static => {
                // A join rather than an `IN (SELECT …)`: the playlist's
                // position column has to stay reachable from `ORDER BY`.
                from_where.push_str(
                    " JOIN playlist_tracks ON playlist_tracks.track_id = tracks.id \
                     AND playlist_tracks.playlist_id = ?",
                );
                params.push(Box::new(playlist_id));
                in_playlist = true;
            }
            Some(_) => {
                let filter = crate::db::playlists::filter(conn, playlist_id)?.unwrap_or_default();
                let compiled = crate::smart::compile(&filter, crate::now_seconds())?;
                conditions.push(compiled.sql);
                params.extend(compiled.params);
            }
        }
    }

    let searching = fts.is_some();
    if let Some(match_expr) = fts {
        from_where.push_str(" JOIN tracks_fts ON tracks_fts.rowid = tracks.id");
        conditions.push("tracks_fts MATCH ?".to_owned());
        params.push(Box::new(match_expr));
    }

    if !conditions.is_empty() {
        from_where.push_str(" WHERE ");
        from_where.push_str(&conditions.join(" AND "));
    }

    Ok(Scope {
        from_where,
        params,
        searching,
        in_playlist,
    })
}

/// Column weights for bm25, in the order the FTS table declares them:
/// title, artist, album, album_artist, genre, comment.
///
/// A hit in the title should outrank a hit buried in a comment, which an
/// unweighted bm25 would treat as equally good. The numbers are a ranking, not
/// a measurement - only their relative order matters.
const BM25_WEIGHTS: &str = "10.0, 8.0, 6.0, 4.0, 2.0, 1.0";

/// The `ORDER BY` body, without the direction.
///
/// NULLs always sort last so untagged files do not head up every ascending
/// view, and `tracks.id` breaks ties so paging stays stable when the sort
/// column has duplicates.
fn order_by(scope: &Scope, query: &TrackQuery) -> String {
    // Relevance only exists while a search is running: bm25 needs the FTS
    // table in the query, and without one there is nothing to rank. Falling
    // back to the field's column keeps a stored "sort by relevance" harmless
    // when the search box is cleared.
    if query.sort_by == SortField::Relevance && scope.searching {
        // Ascending bm25 is best-first - the scores are negative, and more
        // negative means a better match - so relevance deliberately ignores
        // the direction rather than offering a "worst match first" order.
        return format!("bm25(tracks_fts, {BM25_WEIGHTS}), tracks.id ASC");
    }

    // Position is likewise a property of the query, not of a track: the column
    // only exists while a playlist is joined in. Outside one it falls back the
    // same way relevance does, so a playlist's stored sort is harmless when
    // the user clicks back to the library.
    if query.sort_by == SortField::Position && scope.in_playlist {
        let direction = query.direction.as_sql();
        return format!("playlist_tracks.position {direction}, tracks.id {direction}");
    }

    let sort = format!("tracks.{}", query.sort_by.as_sql());
    let direction = query.direction.as_sql();
    format!("{sort} IS NULL, {sort} {direction}, tracks.id {direction}")
}

pub fn count_tracks(conn: &Connection, query: &TrackQuery) -> AppResult<u32> {
    Ok(library_stats(conn, query)?.tracks)
}

/// Count, total duration and total size for the rows `query` covers.
///
/// One statement rather than three: the three always change together, and the
/// table asks for them on every query change, so a round trip each would be
/// waste. `count_tracks` is a thin wrapper over this.
pub fn library_stats(conn: &Connection, query: &TrackQuery) -> AppResult<LibraryStats> {
    let scope = scope(conn, query)?;
    // `sum()` of no rows is NULL in SQLite, not 0 - `coalesce` is what stops an
    // empty library, or a search that matched nothing, from failing to decode.
    let sql = format!(
        "SELECT count(*), coalesce(sum(tracks.duration_ms), 0), coalesce(sum(tracks.size), 0) {}",
        scope.from_where
    );

    let stats = conn.query_row(
        &sql,
        rusqlite::params_from_iter(scope.params.iter()),
        |row| {
            Ok(LibraryStats {
                tracks: row.get::<_, i64>(0)? as u32,
                duration_ms: row.get(1)?,
                bytes: row.get(2)?,
            })
        },
    )?;
    Ok(stats)
}

pub fn query_tracks(conn: &Connection, query: &TrackQuery) -> AppResult<Vec<Track>> {
    let mut scope = scope(conn, query)?;

    // `sort_by`/`direction` are enums whose SQL forms are literals, so this
    // interpolation cannot carry caller input.
    let sql = format!(
        "SELECT {COLUMNS} {} ORDER BY {} LIMIT ? OFFSET ?",
        scope.from_where,
        order_by(&scope, query),
    );
    scope.params.push(Box::new(query.limit.min(MAX_LIMIT)));
    scope.params.push(Box::new(query.offset));

    let mut stmt = conn.prepare(&sql)?;
    let tracks = stmt
        .query_map(
            rusqlite::params_from_iter(scope.params.iter()),
            row_to_track,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(tracks)
}

/// Every matching track id, in the query's sort order.
///
/// Backs "select all": selection is a set of ids, so it must not be limited by
/// the page cap that applies to full rows. Ids are cheap enough to send for a
/// whole library where rows would not be.
pub fn all_track_ids(conn: &Connection, query: &TrackQuery) -> AppResult<Vec<i64>> {
    let scope = scope(conn, query)?;
    let sql = format!(
        "SELECT tracks.id {} ORDER BY {}",
        scope.from_where,
        order_by(&scope, query),
    );

    let mut stmt = conn.prepare(&sql)?;
    let ids = stmt
        .query_map(rusqlite::params_from_iter(scope.params.iter()), |row| {
            row.get(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
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
    use crate::model::SortDirection;

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

    /// Rows whose match lands in a different column, to pin down ranking.
    fn ranked() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        let rows = [
            // (path, title, artist, comment)
            (
                "/r/1.mp3",
                "Filler",
                "Filler",
                "shields mentioned in passing",
            ),
            ("/r/2.mp3", "Shields", "Filler", "nothing"),
            ("/r/3.mp3", "Filler", "Shields", "nothing"),
        ];
        for (path, title, artist, comment) in rows {
            conn.execute(
                "INSERT INTO tracks (path, mtime, size, title, artist, comment, added_at)
                 VALUES (?1, 1, 1, ?2, ?3, ?4, 0)",
                rusqlite::params![path, title, artist, comment],
            )
            .unwrap();
        }
        (dir, db)
    }

    fn paths(tracks: Vec<Track>) -> Vec<String> {
        tracks.into_iter().map(|track| track.path).collect()
    }

    fn relevance_query(search: &str) -> TrackQuery {
        TrackQuery {
            search: Some(search.to_owned()),
            sort_by: SortField::Relevance,
            limit: 100,
            ..Default::default()
        }
    }

    #[test]
    fn relevance_ranks_a_title_hit_above_an_artist_hit_above_a_comment_hit() {
        let (_dir, db) = ranked();
        let conn = db.conn().unwrap();

        let found = query_tracks(&conn, &relevance_query("shields")).unwrap();

        assert_eq!(paths(found), ["/r/2.mp3", "/r/3.mp3", "/r/1.mp3"]);
    }

    #[test]
    fn relevance_ignores_direction_rather_than_offering_worst_match_first() {
        let (_dir, db) = ranked();
        let conn = db.conn().unwrap();

        let ascending = query_tracks(&conn, &relevance_query("shields")).unwrap();
        let descending = query_tracks(
            &conn,
            &TrackQuery {
                direction: SortDirection::Desc,
                ..relevance_query("shields")
            },
        )
        .unwrap();

        assert_eq!(paths(ascending), paths(descending));
    }

    #[test]
    fn relevance_without_a_search_falls_back_to_a_real_column() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();

        // Nothing to rank, so this must behave exactly like the default sort
        // rather than erroring on a bm25 call with no FTS table in the query.
        let ranked = query_tracks(
            &conn,
            &TrackQuery {
                sort_by: SortField::Relevance,
                limit: 100,
                ..Default::default()
            },
        )
        .unwrap();
        let by_artist = query_tracks(
            &conn,
            &TrackQuery {
                sort_by: SortField::Artist,
                limit: 100,
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(paths(ranked), paths(by_artist));
    }

    #[test]
    fn a_search_can_still_be_sorted_by_a_column() {
        let (_dir, db) = ranked();
        let conn = db.conn().unwrap();

        let found = query_tracks(
            &conn,
            &TrackQuery {
                sort_by: SortField::Path,
                direction: SortDirection::Desc,
                ..relevance_query("shields")
            },
        )
        .unwrap();

        assert_eq!(paths(found), ["/r/3.mp3", "/r/2.mp3", "/r/1.mp3"]);
    }

    #[test]
    fn relevance_paging_does_not_overlap_or_skip() {
        let (_dir, db) = ranked();
        let conn = db.conn().unwrap();
        let page = |offset| {
            paths(
                query_tracks(
                    &conn,
                    &TrackQuery {
                        offset,
                        limit: 2,
                        ..relevance_query("shields")
                    },
                )
                .unwrap(),
            )
        };

        assert_eq!(page(0), ["/r/2.mp3", "/r/3.mp3"]);
        assert_eq!(page(2), ["/r/1.mp3"]);
    }

    #[test]
    fn ids_for_a_ranked_search_arrive_in_the_ranked_order() {
        let (_dir, db) = ranked();
        let conn = db.conn().unwrap();

        let ids = all_track_ids(&conn, &relevance_query("shields")).unwrap();
        let rows = query_tracks(&conn, &relevance_query("shields")).unwrap();

        assert_eq!(
            ids,
            rows.iter().map(|track| track.id).collect::<Vec<_>>(),
            "the play queue must match what the table shows"
        );
    }

    /// The seeded library with tracks 1, 3 and 4 in a playlist, deliberately
    /// in an order no column sort would produce.
    fn with_playlist() -> (tempfile::TempDir, Db, i64) {
        let (dir, db) = seeded();
        let mut conn = db.conn().unwrap();
        let ids: Vec<i64> = conn
            .prepare("SELECT id FROM tracks ORDER BY path")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();

        let playlist = crate::db::playlists::create(&conn, "Mix", 0).unwrap();
        crate::db::playlists::add_tracks(&mut conn, playlist.id, &[ids[3], ids[0], ids[2]])
            .unwrap();
        (dir, db, playlist.id)
    }

    fn playlist_query(playlist_id: i64) -> TrackQuery {
        TrackQuery {
            playlist_id: Some(playlist_id),
            sort_by: SortField::Position,
            limit: 100,
            ..Default::default()
        }
    }

    #[test]
    fn a_playlist_view_shows_only_its_members_in_its_own_order() {
        let (_dir, db, playlist_id) = with_playlist();
        let conn = db.conn().unwrap();

        let found = query_tracks(&conn, &playlist_query(playlist_id)).unwrap();
        assert_eq!(paths(found), ["/m/4.mp3", "/m/1.mp3", "/m/3.mp3"]);
        assert_eq!(
            count_tracks(&conn, &playlist_query(playlist_id)).unwrap(),
            3
        );
    }

    #[test]
    fn a_playlist_view_can_still_be_sorted_by_a_column() {
        let (_dir, db, playlist_id) = with_playlist();
        let conn = db.conn().unwrap();

        let found = query_tracks(
            &conn,
            &TrackQuery {
                sort_by: SortField::Path,
                ..playlist_query(playlist_id)
            },
        )
        .unwrap();
        assert_eq!(paths(found), ["/m/1.mp3", "/m/3.mp3", "/m/4.mp3"]);
    }

    #[test]
    fn a_playlist_view_can_be_searched_within() {
        let (_dir, db, playlist_id) = with_playlist();
        let conn = db.conn().unwrap();

        // "Grizzly" matches tracks 3 and 4 in the library; only both of those
        // are in the playlist, while "Guitar" matches 1 and 2 but only 1 is.
        let query = TrackQuery {
            search: Some("Guitar".to_owned()),
            ..playlist_query(playlist_id)
        };
        assert_eq!(count_tracks(&conn, &query).unwrap(), 1);
        assert_eq!(paths(query_tracks(&conn, &query).unwrap()), ["/m/1.mp3"]);
    }

    #[test]
    fn a_playlist_view_pages_without_overlapping_or_skipping() {
        let (_dir, db, playlist_id) = with_playlist();
        let conn = db.conn().unwrap();
        let page = |offset| {
            paths(
                query_tracks(
                    &conn,
                    &TrackQuery {
                        offset,
                        limit: 2,
                        ..playlist_query(playlist_id)
                    },
                )
                .unwrap(),
            )
        };

        assert_eq!(page(0), ["/m/4.mp3", "/m/1.mp3"]);
        assert_eq!(page(2), ["/m/3.mp3"]);
    }

    #[test]
    fn the_play_queue_for_a_playlist_matches_what_the_table_shows() {
        let (_dir, db, playlist_id) = with_playlist();
        let conn = db.conn().unwrap();

        let ids = all_track_ids(&conn, &playlist_query(playlist_id)).unwrap();
        let rows = query_tracks(&conn, &playlist_query(playlist_id)).unwrap();
        assert_eq!(ids, rows.iter().map(|track| track.id).collect::<Vec<_>>());
    }

    #[test]
    fn position_without_a_playlist_falls_back_to_a_real_column() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();

        // Nothing to be positioned in, so this must behave like an ordinary
        // sort rather than erroring on a column that is not in the query.
        let positioned = query_tracks(
            &conn,
            &TrackQuery {
                sort_by: SortField::Position,
                limit: 100,
                ..Default::default()
            },
        )
        .unwrap();
        let by_added = query_tracks(
            &conn,
            &TrackQuery {
                sort_by: SortField::AddedAt,
                limit: 100,
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(paths(positioned), paths(by_added));
    }

    #[test]
    fn an_empty_playlist_is_an_empty_view_not_the_whole_library() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        let playlist = crate::db::playlists::create(&conn, "Empty", 0).unwrap();

        assert_eq!(
            count_tracks(&conn, &playlist_query(playlist.id)).unwrap(),
            0
        );
        assert!(query_tracks(&conn, &playlist_query(playlist.id))
            .unwrap()
            .is_empty());
    }

    fn smart(db: &Db, filter: crate::model::FilterGroup) -> i64 {
        let conn = db.conn().unwrap();
        crate::db::playlists::create_smart(&conn, "Smart", &filter, 0)
            .unwrap()
            .id
    }

    fn artist_is(name: &str) -> crate::model::FilterGroup {
        crate::model::FilterGroup {
            combinator: crate::model::Combinator::All,
            children: vec![crate::model::FilterNode::Rule(crate::model::FilterRule {
                field: crate::model::FilterField::Artist,
                op: crate::model::FilterOp::Is,
                value: crate::model::FilterValue::Text {
                    text: name.to_owned(),
                },
            })],
        }
    }

    #[test]
    fn a_smart_playlist_view_is_its_filter() {
        let (_dir, db) = seeded();
        let id = smart(&db, artist_is("Grizzly Bear"));
        let conn = db.conn().unwrap();
        let query = TrackQuery {
            playlist_id: Some(id),
            limit: 100,
            ..Default::default()
        };

        assert_eq!(count_tracks(&conn, &query).unwrap(), 2);
        assert_eq!(
            paths(query_tracks(&conn, &query).unwrap()),
            ["/m/3.mp3", "/m/4.mp3"]
        );
    }

    #[test]
    fn a_smart_playlist_re_evaluates_as_the_library_changes() {
        let (_dir, db) = seeded();
        let id = smart(&db, artist_is("Grizzly Bear"));
        let conn = db.conn().unwrap();
        let query = TrackQuery {
            playlist_id: Some(id),
            ..Default::default()
        };
        assert_eq!(count_tracks(&conn, &query).unwrap(), 2);

        conn.execute(
            "INSERT INTO tracks (path, mtime, size, title, artist, added_at)
             VALUES ('/m/9.mp3', 1, 1, 'Yet Again', 'Grizzly Bear', 0)",
            [],
        )
        .unwrap();

        // Nothing was materialised, so nothing has to be invalidated.
        assert_eq!(count_tracks(&conn, &query).unwrap(), 3);
    }

    #[test]
    fn a_search_narrows_a_smart_playlist_rather_than_replacing_it() {
        let (_dir, db) = seeded();
        let id = smart(&db, artist_is("Grizzly Bear"));
        let conn = db.conn().unwrap();

        let query = TrackQuery {
            playlist_id: Some(id),
            search: Some("Shields".to_owned()),
            sort_by: SortField::Relevance,
            limit: 100,
            ..Default::default()
        };

        // "Shields" matches both Grizzly Bear tracks in the library, and only
        // one of the two is on the Shields album.
        assert_eq!(count_tracks(&conn, &query).unwrap(), 2);
        assert_eq!(
            paths(query_tracks(&conn, &query).unwrap()),
            ["/m/3.mp3", "/m/4.mp3"]
        );
    }

    #[test]
    fn a_playlist_that_has_been_deleted_reads_as_an_empty_view() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        let query = TrackQuery {
            playlist_id: Some(404),
            limit: 100,
            ..Default::default()
        };

        // Not the whole library, which is what dropping the clause would give.
        assert_eq!(count_tracks(&conn, &query).unwrap(), 0);
        assert!(query_tracks(&conn, &query).unwrap().is_empty());
    }

    #[test]
    fn the_sidebar_count_for_a_smart_playlist_is_what_its_view_shows() {
        let (_dir, db) = seeded();
        let id = smart(&db, artist_is("Guitar"));
        let conn = db.conn().unwrap();

        let listed = crate::db::playlists::list(&conn).unwrap();
        let counted = count_tracks(
            &conn,
            &TrackQuery {
                playlist_id: Some(id),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(listed[0].track_count, counted as i64);
        assert_eq!(counted, 2);
    }

    #[test]
    fn counting_a_search_is_unaffected_by_how_it_is_sorted() {
        let (_dir, db) = ranked();
        let conn = db.conn().unwrap();

        assert_eq!(count_tracks(&conn, &relevance_query("shields")).unwrap(), 3);
        assert_eq!(
            count_tracks(
                &conn,
                &TrackQuery {
                    sort_by: SortField::Title,
                    ..relevance_query("shields")
                }
            )
            .unwrap(),
            3
        );
    }

    #[test]
    fn totals_cover_the_whole_view() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();

        let stats = library_stats(&conn, &TrackQuery::default()).unwrap();

        assert_eq!(stats.tracks, 5);
        // The untagged row has a NULL duration, which `sum` skips rather than
        // poisoning the total with.
        assert_eq!(stats.duration_ms, 208_000 + 301_000 + 330_000 + 271_000);
        assert_eq!(stats.bytes, 5);
    }

    #[test]
    fn an_empty_library_totals_zero_rather_than_failing() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();

        // `sum()` of no rows is NULL in SQLite, not 0. Without the coalesce
        // this does not return zeroes, it fails to decode.
        let stats = library_stats(&conn, &TrackQuery::default()).unwrap();

        assert_eq!(stats, LibraryStats::default());
    }

    #[test]
    fn a_search_that_matches_nothing_totals_zero() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();

        let stats = library_stats(
            &conn,
            &TrackQuery {
                search: Some("nothingmatchesthis".to_owned()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(stats, LibraryStats::default());
    }

    #[test]
    fn totals_follow_the_filter_rather_than_the_library() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();

        let stats = library_stats(
            &conn,
            &TrackQuery {
                search: Some("Grizzly".to_owned()),
                ..Default::default()
            },
        )
        .unwrap();

        // The footer describes what is on screen. A search showing two songs
        // that claims the library's total would be worse than showing nothing.
        assert_eq!(stats.tracks, 2);
        assert_eq!(stats.duration_ms, 330_000 + 271_000);
    }

    #[test]
    fn counting_and_totalling_agree() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        let query = TrackQuery {
            search: Some("Guitar".to_owned()),
            ..Default::default()
        };

        // `count_tracks` is a wrapper over `library_stats`; if they ever
        // disagree the scrollbar and the footer are describing different views.
        assert_eq!(
            count_tracks(&conn, &query).unwrap(),
            library_stats(&conn, &query).unwrap().tracks
        );
    }

    #[test]
    fn totals_survive_a_library_larger_than_a_32_bit_sum() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        // Four rows of roughly 1.5 billion each: past u32 in both columns, and
        // the reason these are i64 rather than the u32 the count uses.
        for i in 0..4 {
            conn.execute(
                "INSERT INTO tracks (path, mtime, size, duration_ms, added_at)
                 VALUES (?1, 1, ?2, ?2, 0)",
                rusqlite::params![format!("/m/big{i}.mp3"), 1_500_000_000_i64],
            )
            .unwrap();
        }

        let stats = library_stats(&conn, &TrackQuery::default()).unwrap();

        assert_eq!(stats.duration_ms, 6_000_000_000);
        assert_eq!(stats.bytes, 6_000_000_000);
    }
}
