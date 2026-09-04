//! Reading tracks back out.
//!
//! Every query is paged. Nothing here ever loads the whole library: the table
//! asks for the window it is about to render plus a count for the scrollbar.

use rusqlite::{Connection, OptionalExtension, Row};

use crate::error::AppResult;
use crate::model::{
    BrowseGroup, BrowseKind, LibraryStats, PlaylistKind, SortField, Track, TrackQuery,
};

/// The artist a track is filed under.
///
/// `album_artist` first so a compilation stays one album instead of shattering
/// into one per track, falling back to `artist`. `nullif` folds empty strings
/// into NULL: a tag written as `""` is untagged, and without this it would be
/// its own group sorting above everything.
const GROUP_ARTIST: &str = "coalesce(nullif(tracks.album_artist, ''), nullif(tracks.artist, ''))";
const GROUP_ALBUM: &str = "nullif(tracks.album, '')";
const GROUP_GENRE: &str = "nullif(tracks.genre, '')";

impl BrowseKind {
    /// The expression a group is keyed by.
    fn key_sql(self) -> &'static str {
        match self {
            Self::Albums => GROUP_ALBUM,
            Self::Artists => GROUP_ARTIST,
            Self::Genres => GROUP_GENRE,
        }
    }
}

/// Table-qualified: `tracks_fts` carries columns of the same names, so an
/// unqualified list is ambiguous the moment a search joins it in.
pub(crate) const COLUMNS: &str =
    "tracks.id, tracks.path, tracks.duration_ms, tracks.title, tracks.artist, \
                       tracks.album, tracks.album_artist, tracks.genre, tracks.year, \
                       tracks.track_no, tracks.disc_no, tracks.comment, tracks.bitrate, \
                       tracks.sample_rate, tracks.cover_hash, tracks.added_at, \
                       tracks.play_count, tracks.last_played_at, tracks.missing_since";

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
        missing_since: row.get(18)?,
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
                let order = crate::db::playlists::order(conn, playlist_id)?;
                let compiled = crate::smart::compile(&filter, crate::now_seconds())?;

                match order.limit {
                    None => {
                        conditions.push(compiled.sql);
                        params.extend(compiled.params);
                    }
                    // A cutoff decides *membership*, so it belongs here, in the
                    // scope every query shares, rather than as a `LIMIT` on the
                    // page. Appending one to the page query would mean the open
                    // playlist changed which hundred songs it held whenever the
                    // user clicked a column header, and searching inside it
                    // would search the whole library. As a condition, the count,
                    // the page, the id list and the sidebar's number all narrow
                    // together with no arithmetic at the call sites.
                    Some(limit) => {
                        // The inner `FROM tracks` is what the compiled filter's
                        // `tracks.`-qualified columns bind to - the innermost
                        // scope wins - so this reads as a plain subquery rather
                        // than a correlated one. Aliasing the inner table would
                        // silently turn every one of those references into a
                        // reference to the *outer* row, which is why it is not
                        // aliased however tempting that looks.
                        conditions.push(format!(
                            "tracks.id IN (SELECT tracks.id FROM tracks WHERE {} ORDER BY {} LIMIT ?)",
                            compiled.sql,
                            smart_order_by(order.sort),
                        ));
                        params.extend(compiled.params);
                        params.push(Box::new(limit.min(crate::db::playlists::MAX_SMART_LIMIT)));
                    }
                }
            }
        }
    }

    if let Some(browse) = &query.browse {
        // `IS ?` rather than `= ?`: a bound NULL never equals anything in SQL,
        // so `=` would silently return no rows for the untagged group instead
        // of selecting it. `IS` compares NULLs as equal, which is what an
        // absent tag needs here.
        //
        // `COLLATE NOCASE` because [`browse_groups`] folds case: the tile is
        // labelled with the one casing `min()` picked, so without the same
        // collation here opening it would show only that casing's tracks.
        conditions.push(format!("{} IS ? COLLATE NOCASE", browse.kind.key_sql()));
        params.push(Box::new(browse.key.clone()));

        // Only albums are keyed by two columns; for the other two the artist
        // is the key itself and constraining it again would be a no-op at best.
        if browse.kind == BrowseKind::Albums {
            conditions.push(format!("{GROUP_ARTIST} IS ? COLLATE NOCASE"));
            params.push(Box::new(browse.secondary.clone()));
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

/// The `ORDER BY` that decides which rows a smart playlist's cutoff keeps.
///
/// Not the display order - that is [`order_by`], driven by whatever the user
/// clicked. This one runs inside the membership subquery, where the only thing
/// it settles is which N songs are in the playlist at all.
///
/// With no sort stored there is nothing to rank by, and a bare `LIMIT` over an
/// unordered query returns whatever SQLite finds first - which is stable in
/// practice and guaranteed by nothing. Ordering by id makes "the first hundred"
/// mean the same hundred on every run, which is the least surprising thing an
/// unsorted cutoff can do.
///
/// `sort.field` is an enum whose SQL forms are literals, and it has already been
/// checked to be a real track column, so this interpolation carries no input.
fn smart_order_by(sort: Option<crate::model::SmartSort>) -> String {
    let Some(sort) = sort else {
        return "tracks.id ASC".to_owned();
    };
    let column = format!("tracks.{}", sort.field.as_sql());
    let direction = sort.direction.as_sql();
    // NULLs last and a tie-break on id, matching the display order's
    // convention: an untagged file should not head up "Recently Added", and
    // ties have to break the same way every time or the hundredth song in the
    // playlist changes between two queries that should agree.
    format!("{column} IS NULL, {column} {direction}, tracks.id {direction}")
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
    // The missing count rides along for the same reason: it is asked for
    // exactly when the totals are, and `count(...)` over a filtered expression
    // is free next to a scan that is already happening.
    // The tombstone count rides along as a scalar subquery rather than a
    // second round trip, and deliberately outside `scope`: the rows those
    // paths named are gone, so there is no view for them to be narrowed to.
    let sql = format!(
        "SELECT count(*), coalesce(sum(tracks.duration_ms), 0), coalesce(sum(tracks.size), 0), \
         count(tracks.missing_since), (SELECT count(*) FROM removed_paths) {}",
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
                missing: row.get::<_, i64>(3)? as u32,
                removed: row.get::<_, i64>(4)? as u32,
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

/// The albums, artists or genres inside `query`'s scope.
///
/// Runs through the same [`scope`] the songs table uses, so an open playlist or
/// a running search narrows this list exactly as it narrows the rows - without
/// a second notion of what the current view contains.
///
/// Unpaged, deliberately. Ten thousand tracks is a few hundred albums, and a
/// browse view that loaded a page at a time would need a count query and a
/// window cache to render a grid that fits in memory many times over. The
/// frontend still virtualizes the rendering.
pub fn browse_groups(
    conn: &Connection,
    query: &TrackQuery,
    kind: BrowseKind,
) -> AppResult<Vec<BrowseGroup>> {
    // A browse filter restricts the songs table, not the list of groups: a
    // query still carrying the album the user drilled into would return that
    // one album. `kind` is a parameter for the same reason - which grouping to
    // show is a property of the open tab, not of a drill-in that may not exist.
    let scope = scope(
        conn,
        &TrackQuery {
            browse: None,
            ..query.clone()
        },
    )?;

    let key = kind.key_sql();

    // Albums carry their artist so the grid can label them and so the drill-in
    // can filter by both. The other two have no second key.
    let secondary = if kind == BrowseKind::Albums {
        GROUP_ARTIST
    } else {
        "NULL"
    };

    // `COLLATE NOCASE` on both keys: a release tagged `A Sense Of Purpose` on
    // one file and `A Sense of Purpose` on the next is one release and was two
    // tiles. Grouping on a folded key leaves no row of the group carrying the
    // label, so `min()` picks it - a binary comparison, so the uppercase
    // variant, arbitrary but the same one every time, which is what the grid's
    // React keys need. `min()` of an all-NULL group is still NULL, so the
    // untagged group keeps its key and its place last.
    //
    // `min(year)` rather than any year: a remaster tagged a year later should
    // not move an album to the wrong end of a chronological sort.
    let sql = format!(
        "SELECT min({key}) AS group_key, min({secondary}) AS group_secondary, count(*), \
         coalesce(sum(tracks.duration_ms), 0), min(tracks.cover_hash), min(tracks.year) {} \
         GROUP BY {key} COLLATE NOCASE, {secondary} COLLATE NOCASE \
         ORDER BY group_key IS NULL, group_key COLLATE NOCASE ASC, \
                  group_secondary COLLATE NOCASE ASC",
        scope.from_where
    );

    let mut stmt = conn.prepare(&sql)?;
    let groups = stmt
        .query_map(rusqlite::params_from_iter(scope.params.iter()), |row| {
            Ok(BrowseGroup {
                key: row.get(0)?,
                secondary: row.get(1)?,
                track_count: row.get::<_, i64>(2)? as u32,
                duration_ms: row.get(3)?,
                cover_hash: row.get(4)?,
                year: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(groups)
}

/// The order files of one release are read in, which is the order the lookup
/// dialog maps them to a tracklist in.
///
/// `coalesce` on the disc because a single-disc release usually leaves it
/// untagged, and a NULL would otherwise sort the untagged files above disc 1
/// of the ones that are tagged.
const RELEASE_ORDER: &str = "coalesce(tracks.disc_no, 1), tracks.track_no, tracks.path";

/// Splits a selection into the releases it covers.
///
/// A release is the unit a lookup is worth doing at - 65,535 tracks are some
/// 8,000 releases, and the limiter lets one request out every ten seconds -
/// so this is what decides how many lookups a selection costs.
///
/// Grouped by the browse view's own expressions, empty strings and all, so
/// that a release is the same thing here as it is in the grid. Anything else
/// would be a second notion of what an album is.
pub fn release_selections(
    conn: &Connection,
    track_ids: &[i64],
) -> AppResult<Vec<crate::model::ReleaseSelection>> {
    if track_ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = vec!["?"; track_ids.len()].join(", ");
    let sql = format!(
        "SELECT {GROUP_ALBUM}, {GROUP_ARTIST}, tracks.id
           FROM tracks
          WHERE tracks.id IN ({placeholders})
          ORDER BY {GROUP_ARTIST} COLLATE NOCASE, {GROUP_ALBUM} COLLATE NOCASE, \
                   {RELEASE_ORDER}"
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(track_ids.iter()), |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // Consecutive rather than hashed: the query already orders by the two keys,
    // and this way the groups come out in the order the user would read them.
    let mut selections: Vec<crate::model::ReleaseSelection> = Vec::new();
    for (album, artist, id) in rows {
        match selections.last_mut() {
            Some(last) if same_release(last, &album, &artist) => last.track_ids.push(id),
            _ => selections.push(crate::model::ReleaseSelection {
                album,
                artist,
                track_ids: vec![id],
            }),
        }
    }
    Ok(selections)
}

/// Whether a row belongs to the release being accumulated, folding case the
/// way the browse view groups: a release tagged two ways is one release, and
/// unfolded it would be searched twice, ten rate-limited seconds apart, and
/// offered to the user twice.
///
/// ASCII-only, like the `NOCASE` collation it mirrors.
fn same_release(
    selection: &crate::model::ReleaseSelection,
    album: &Option<String>,
    artist: &Option<String>,
) -> bool {
    same_key(&selection.album, album) && same_key(&selection.artist, artist)
}

/// Whether two halves of a release key are the same one, ASCII-only like the
/// `NOCASE` collation the queries group by.
fn same_key(a: &Option<String>, b: &Option<String>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
        (None, None) => true,
        _ => false,
    }
}

/// One file of a release, as the lookup needs it.
pub struct ReleaseMember {
    pub id: i64,
    pub duration_ms: i64,
    /// What the file already says, so the unattended pass can fill an empty
    /// genre without writing over one somebody chose by hand.
    pub genre: Option<String>,
    /// Whether the file already has artwork, so a pass does not stage a JPEG
    /// per release to replace a cover that is already there.
    pub cover_hash: Option<String>,
}

/// Every file of a release, selected or not.
///
/// Two things need the whole release rather than the selection. Scoring: three
/// files out of twelve would otherwise make every twelve-track candidate look
/// wrong. And the identifiers: they are written to every file of the release,
/// because a release half of whose files carry an identity is the defect the
/// identity exists to remove.
///
/// Missing files are left out. They cannot be written and cannot be read for
/// their duration, so counting them would inflate both the score's denominator
/// and the write's failure count.
pub fn release_members(
    conn: &Connection,
    album: Option<&str>,
    artist: Option<&str>,
) -> AppResult<Vec<ReleaseMember>> {
    // `IS` rather than `=`, so an untagged release matches on NULL the same way
    // selecting it from the browse grid does, and `COLLATE NOCASE` so a release
    // tagged two ways comes back whole: handed one casing this would otherwise
    // return half of it, and the identity would be written to that half.
    let sql = format!(
        "SELECT tracks.id, tracks.duration_ms, tracks.genre, tracks.cover_hash
           FROM tracks
          WHERE {GROUP_ALBUM} IS ?1 COLLATE NOCASE
            AND {GROUP_ARTIST} IS ?2 COLLATE NOCASE
            AND tracks.missing_since IS NULL
          ORDER BY {RELEASE_ORDER}"
    );

    let mut stmt = conn.prepare(&sql)?;
    let members = stmt
        .query_map(rusqlite::params![album, artist], |row| {
            Ok(ReleaseMember {
                id: row.get(0)?,
                duration_ms: row.get(1)?,
                genre: row.get(2)?,
                cover_hash: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(members)
}

/// One file of a release, as the mover needs it: everything
/// [`crate::library::layout`] reads, plus the path it is at now.
pub struct ReleaseFile {
    pub id: i64,
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub year: Option<i64>,
    pub track_no: Option<i64>,
    pub disc_no: Option<i64>,
    pub release_type: Option<String>,
    /// Whether the last scan failed to find it. Such a row is not moved - see
    /// [`crate::library::mover`].
    pub missing: bool,
}

/// Every file of a release, in the order a tracklist reads.
///
/// Missing files are included, unlike [`release_members`]: they are not moved,
/// but they are still part of the release, and the disc count the layout asks
/// for is a fact about the release rather than about the files present today.
pub fn release_files(
    conn: &Connection,
    album: Option<&str>,
    artist: Option<&str>,
) -> AppResult<Vec<ReleaseFile>> {
    // `IS` and `COLLATE NOCASE` for the reasons `release_members` gives: a
    // release tagged two ways is one release, and half a release moved is the
    // one state this is written to avoid.
    let sql = format!(
        "SELECT {RELEASE_FILE_COLUMNS}
           FROM tracks
          WHERE {GROUP_ALBUM} IS ?1 COLLATE NOCASE
            AND {GROUP_ARTIST} IS ?2 COLLATE NOCASE
          ORDER BY {RELEASE_ORDER}"
    );

    let mut stmt = conn.prepare(&sql)?;
    let files = stmt
        .query_map(rusqlite::params![album, artist], |row| release_file(row, 0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(files)
}

/// The columns a [`ReleaseFile`] is read from, spelled once for the two
/// statements that select them.
const RELEASE_FILE_COLUMNS: &str = "tracks.id, tracks.path, tracks.title, tracks.artist,
                tracks.year, tracks.track_no, tracks.disc_no, tracks.release_type,
                tracks.missing_since IS NOT NULL";

fn release_file(row: &Row<'_>, first: usize) -> rusqlite::Result<ReleaseFile> {
    Ok(ReleaseFile {
        id: row.get(first)?,
        path: row.get(first + 1)?,
        title: row.get(first + 2)?,
        artist: row.get(first + 3)?,
        year: row.get(first + 4)?,
        track_no: row.get(first + 5)?,
        disc_no: row.get(first + 6)?,
        release_type: row.get(first + 7)?,
        missing: row.get(first + 8)?,
    })
}

/// Every release in the library with its files, one release at a time.
///
/// One ordered pass, grouping consecutive rows the way [`release_selections`]
/// does, rather than a [`release_files`] per release: that one matches on the
/// grouping expressions, so a call per release is a full table scan per
/// release - 8,044 of them over 65,535 rows to be told a filed library is
/// filed.
///
/// **Not free either.** The order is over `coalesce(nullif(…))` expressions
/// with no index behind them, so it is a temp-b-tree sort of every row in
/// `tracks` plus a path per row.
///
/// Missing rows are handed over too, exactly as [`release_files`] hands them
/// over: what the release is called, when it came out and how many discs it
/// has are facts about the release rather than about the files present today,
/// and a caller that drew them from a subset would compute a different answer
/// than one that called [`release_files`].
pub fn for_each_release(
    conn: &Connection,
    mut each: impl FnMut(Option<String>, Option<String>, &[ReleaseFile]),
) -> AppResult<()> {
    // The same order `lookup::pending` reads releases in, so a pass over this
    // and a pass over that one work through the library the same way.
    let sql = format!(
        "SELECT {GROUP_ALBUM}, {GROUP_ARTIST}, {RELEASE_FILE_COLUMNS}
           FROM tracks
          ORDER BY {GROUP_ARTIST} IS NULL, {GROUP_ARTIST} COLLATE NOCASE,
                   {GROUP_ALBUM}  IS NULL, {GROUP_ALBUM}  COLLATE NOCASE,
                   {RELEASE_ORDER}"
    );

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([])?;
    // The key of the release being accumulated, in the casing of its first
    // row: rows of one release can disagree about that, and the folder they
    // are filed into has to be one answer that does not move between sweeps.
    let mut key: Option<(Option<String>, Option<String>)> = None;
    let mut files: Vec<ReleaseFile> = Vec::new();

    while let Some(row) = rows.next()? {
        let album: Option<String> = row.get(0)?;
        let artist: Option<String> = row.get(1)?;
        let started = match &key {
            Some((album_of, artist_of)) => {
                !same_key(album_of, &album) || !same_key(artist_of, &artist)
            }
            None => true,
        };
        if started {
            if let Some((album_of, artist_of)) = key.take() {
                each(album_of, artist_of, &files);
                files.clear();
            }
            key = Some((album.clone(), artist.clone()));
        }
        files.push(release_file(row, 2)?);
    }
    if let Some((album, artist)) = key {
        each(album, artist, &files);
    }
    Ok(())
}

/// What release a track now belongs to.
///
/// By id, so it answers for a row whose tags have just been rewritten - which
/// is what the unattended pass asks after a lookup wrote a new album and
/// artist onto every file of a release, and its old key stopped naming it.
pub fn release_of(
    conn: &Connection,
    track_id: i64,
) -> AppResult<Option<(Option<String>, Option<String>)>> {
    let sql = format!("SELECT {GROUP_ALBUM}, {GROUP_ARTIST} FROM tracks WHERE tracks.id = ?1");
    Ok(conn
        .query_row(&sql, [track_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()?)
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
    use crate::model::{BrowseFilter, FilterGroup, SmartOrder, SmartSort, SortDirection};

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

    fn smart(db: &Db, filter: FilterGroup) -> i64 {
        let conn = db.conn().unwrap();
        crate::db::playlists::create_smart(&conn, "Smart", &filter, &SmartOrder::default(), 0)
            .unwrap()
            .id
    }

    fn artist_is(name: &str) -> FilterGroup {
        FilterGroup {
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

    fn smart_with(db: &Db, filter: FilterGroup, order: SmartOrder) -> i64 {
        let conn = db.conn().unwrap();
        crate::db::playlists::create_smart(&conn, "Top", &filter, &order, 0)
            .unwrap()
            .id
    }

    fn top(field: SortField, limit: u32) -> SmartOrder {
        SmartOrder {
            sort: Some(SmartSort {
                field,
                direction: SortDirection::Desc,
            }),
            limit: Some(limit),
        }
    }

    /// The seeded library with play counts, so a "most played" cutoff has
    /// something to rank: /m/1 once through to /m/4 four times, /m/5 never.
    fn played() -> (tempfile::TempDir, Db) {
        let (dir, db) = seeded();
        let conn = db.conn().unwrap();
        for plays in 1..=4 {
            conn.execute(
                "UPDATE tracks SET play_count = ?1 WHERE path = ?2",
                rusqlite::params![plays, format!("/m/{plays}.mp3")],
            )
            .unwrap();
        }
        (dir, db)
    }

    /// Paths in the view, sorted, so an assertion is about *which* songs the
    /// playlist holds rather than about the order they were displayed in.
    fn members(conn: &Connection, query: &TrackQuery) -> Vec<String> {
        let mut found = paths(query_tracks(conn, query).unwrap());
        found.sort();
        found
    }

    #[test]
    fn a_cutoff_decides_which_songs_the_playlist_holds() {
        let (_dir, db) = played();
        let id = smart_with(&db, FilterGroup::default(), top(SortField::PlayCount, 2));
        let conn = db.conn().unwrap();
        let query = TrackQuery {
            playlist_id: Some(id),
            limit: 100,
            ..Default::default()
        };

        // The two most played, not the first two of five.
        assert_eq!(members(&conn, &query), ["/m/3.mp3", "/m/4.mp3"]);
        // And the count agrees, without anyone computing min(total, limit):
        // it runs through the same scope the rows did.
        assert_eq!(count_tracks(&conn, &query).unwrap(), 2);
        assert_eq!(library_stats(&conn, &query).unwrap().tracks, 2);
        assert_eq!(all_track_ids(&conn, &query).unwrap().len(), 2);
    }

    #[test]
    fn sorting_the_view_reorders_it_without_changing_what_is_in_it() {
        let (_dir, db) = played();
        let id = smart_with(&db, FilterGroup::default(), top(SortField::PlayCount, 2));
        let conn = db.conn().unwrap();
        let view = |sort_by, direction| TrackQuery {
            playlist_id: Some(id),
            sort_by,
            direction,
            limit: 100,
            ..Default::default()
        };

        // This is the whole reason the cutoff lives in the scope rather than on
        // the page query: clicking a column header must not hand the user a
        // different two songs.
        let expected = ["/m/3.mp3", "/m/4.mp3"];
        assert_eq!(
            members(&conn, &view(SortField::Title, SortDirection::Asc)),
            expected
        );
        assert_eq!(
            members(&conn, &view(SortField::Path, SortDirection::Desc)),
            expected
        );
        assert_eq!(
            members(&conn, &view(SortField::PlayCount, SortDirection::Asc)),
            expected,
            "even sorting by the cutoff's own column, backwards"
        );
    }

    #[test]
    fn a_search_inside_a_limited_playlist_searches_only_what_it_holds() {
        let (_dir, db) = played();
        // The top two by play count are Half Gate (3) and Gun-Shy (4), so the
        // Guitar tracks are outside the playlist entirely.
        let id = smart_with(&db, FilterGroup::default(), top(SortField::PlayCount, 2));
        let conn = db.conn().unwrap();
        let search = |term: &str| TrackQuery {
            playlist_id: Some(id),
            search: Some(term.to_owned()),
            sort_by: SortField::Relevance,
            limit: 100,
            ..Default::default()
        };

        assert_eq!(members(&conn, &search("Shields")), ["/m/3.mp3", "/m/4.mp3"]);
        // In the library, "Tokyo" matches two tracks. In this playlist it
        // matches none - which `min(count, limit)` could not have told us.
        assert_eq!(count_tracks(&conn, &search("Tokyo")).unwrap(), 0);
        assert!(query_tracks(&conn, &search("Tokyo")).unwrap().is_empty());
    }

    #[test]
    fn a_cutoff_composes_with_the_filter_rather_than_replacing_it() {
        let (_dir, db) = played();
        // Grizzly Bear only, then the single most played of those.
        let id = smart_with(&db, artist_is("Grizzly Bear"), top(SortField::PlayCount, 1));
        let conn = db.conn().unwrap();
        let query = TrackQuery {
            playlist_id: Some(id),
            limit: 100,
            ..Default::default()
        };

        assert_eq!(members(&conn, &query), ["/m/4.mp3"]);
    }

    #[test]
    fn a_cutoff_larger_than_the_library_is_not_a_restriction() {
        let (_dir, db) = played();
        let id = smart_with(&db, FilterGroup::default(), top(SortField::PlayCount, 500));
        let conn = db.conn().unwrap();
        let query = TrackQuery {
            playlist_id: Some(id),
            limit: 100,
            ..Default::default()
        };

        assert_eq!(count_tracks(&conn, &query).unwrap(), 5);
    }

    #[test]
    fn the_playlist_follows_the_library_rather_than_freezing_the_first_hundred() {
        let (_dir, db) = played();
        let id = smart_with(&db, FilterGroup::default(), top(SortField::PlayCount, 2));
        let conn = db.conn().unwrap();
        let query = TrackQuery {
            playlist_id: Some(id),
            limit: 100,
            ..Default::default()
        };
        assert_eq!(members(&conn, &query), ["/m/3.mp3", "/m/4.mp3"]);

        // Playing /m/1 six times should push /m/3 out. Nothing is
        // materialised, so nothing needs invalidating - the same property the
        // unlimited case has.
        conn.execute(
            "UPDATE tracks SET play_count = 6 WHERE path = '/m/1.mp3'",
            [],
        )
        .unwrap();

        assert_eq!(members(&conn, &query), ["/m/1.mp3", "/m/4.mp3"]);
    }

    #[test]
    fn a_cutoff_with_no_sort_still_picks_the_same_songs_every_time() {
        let (_dir, db) = played();
        let id = smart_with(
            &db,
            FilterGroup::default(),
            SmartOrder {
                sort: None,
                limit: Some(3),
            },
        );
        let conn = db.conn().unwrap();
        let query = TrackQuery {
            playlist_id: Some(id),
            limit: 100,
            ..Default::default()
        };

        // Which three is arbitrary; that it is the *same* three on every query
        // is not, and a bare LIMIT over an unordered query guarantees nothing.
        let first = members(&conn, &query);
        assert_eq!(first.len(), 3);
        assert_eq!(members(&conn, &query), first);
    }

    #[test]
    fn an_untagged_row_does_not_head_up_a_descending_cutoff() {
        let (_dir, db) = played();
        // /m/5 has no year at all. Sorted by year descending, NULL must not
        // outrank 2015 and take one of the two places.
        let id = smart_with(&db, FilterGroup::default(), top(SortField::Year, 2));
        let conn = db.conn().unwrap();
        let query = TrackQuery {
            playlist_id: Some(id),
            limit: 100,
            ..Default::default()
        };

        let found = members(&conn, &query);
        assert!(
            !found.contains(&"/m/5.mp3".to_owned()),
            "the untagged row took a place: {found:?}"
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

    /// A library with the shapes that break naive grouping: a compilation
    /// whose per-track artists differ, an album split across two discs, an
    /// album name reused by a different artist, and an untagged file.
    fn browsable() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();

        // `tracks.cover_hash` is a foreign key, so the art has to exist before
        // a track can point at it.
        for hash in ["ca", "cb"] {
            conn.execute(
                "INSERT INTO covers (hash, mime, bytes) VALUES (?1, 'image/jpeg', x'00')",
                [hash],
            )
            .unwrap();
        }

        // (path, title, artist, album_artist, album, genre, disc, year, cover)
        let rows = [
            // A compilation: three artists, one album_artist holding it together.
            (
                "/b/1.mp3",
                "One",
                "Alice",
                Some("Various Artists"),
                "Comp",
                "Pop",
                1,
                2001,
                Some("ca"),
            ),
            (
                "/b/2.mp3",
                "Two",
                "Bob",
                Some("Various Artists"),
                "Comp",
                "Pop",
                1,
                2001,
                Some("ca"),
            ),
            (
                "/b/3.mp3",
                "Three",
                "Carol",
                Some("Various Artists"),
                "Comp",
                "Rock",
                1,
                2001,
                None,
            ),
            // One album, two discs - still one album.
            (
                "/b/4.mp3",
                "D1",
                "Dio",
                Some("Dio"),
                "Double",
                "Rock",
                1,
                1985,
                Some("cb"),
            ),
            (
                "/b/5.mp3",
                "D2",
                "Dio",
                Some("Dio"),
                "Double",
                "Rock",
                2,
                1985,
                Some("cb"),
            ),
            // Same album title, different artist: two groups, not one.
            (
                "/b/6.mp3",
                "Greatest",
                "Eve",
                Some("Eve"),
                "Double",
                "Jazz",
                1,
                1990,
                None,
            ),
            // No album_artist at all - falls back to artist.
            (
                "/b/7.mp3", "Solo", "Frank", None, "Alone", "Jazz", 1, 1995, None,
            ),
        ];
        for (path, title, artist, album_artist, album, genre, disc, year, cover) in rows {
            conn.execute(
                "INSERT INTO tracks (path, mtime, size, duration_ms, title, artist, album_artist,
                                     album, genre, disc_no, year, cover_hash, added_at)
                 VALUES (?1, 1, 1, 1000, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)",
                rusqlite::params![
                    path,
                    title,
                    artist,
                    album_artist,
                    album,
                    genre,
                    disc,
                    year,
                    cover
                ],
            )
            .unwrap();
        }
        // Untagged, and an empty-string album which must not become its own group.
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, added_at) VALUES ('/b/8.mp3', 1, 1, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, album, artist, added_at)
             VALUES ('/b/9.mp3', 1, 1, '', '', 0)",
            [],
        )
        .unwrap();
        (dir, db)
    }

    fn browse(db: &Db, kind: BrowseKind) -> Vec<BrowseGroup> {
        let conn = db.conn().unwrap();
        browse_groups(&conn, &TrackQuery::default(), kind).unwrap()
    }

    fn keys(groups: &[BrowseGroup]) -> Vec<Option<&str>> {
        groups.iter().map(|g| g.key.as_deref()).collect()
    }

    #[test]
    fn a_compilation_is_one_album_not_one_per_artist() {
        let (_dir, db) = browsable();
        let albums = browse(&db, BrowseKind::Albums);

        let comp = albums
            .iter()
            .find(|g| g.key.as_deref() == Some("Comp"))
            .expect("the compilation should be one group");
        assert_eq!(comp.track_count, 3);
        assert_eq!(comp.secondary.as_deref(), Some("Various Artists"));
    }

    #[test]
    fn an_album_spanning_two_discs_is_one_album() {
        let (_dir, db) = browsable();
        let albums = browse(&db, BrowseKind::Albums);

        let doubles: Vec<_> = albums
            .iter()
            .filter(|g| g.key.as_deref() == Some("Double"))
            .collect();

        // Two groups because two different artists use the title, and the
        // two-disc one holds both its discs.
        assert_eq!(
            doubles.len(),
            2,
            "same title by different artists must not merge"
        );
        let dio = doubles
            .iter()
            .find(|g| g.secondary.as_deref() == Some("Dio"))
            .unwrap();
        assert_eq!(dio.track_count, 2, "both discs belong to one album");
    }

    #[test]
    fn an_absent_album_artist_falls_back_to_the_artist() {
        let (_dir, db) = browsable();
        let albums = browse(&db, BrowseKind::Albums);

        let alone = albums
            .iter()
            .find(|g| g.key.as_deref() == Some("Alone"))
            .unwrap();
        assert_eq!(alone.secondary.as_deref(), Some("Frank"));
    }

    #[test]
    fn untagged_files_group_together_and_sort_last() {
        let (_dir, db) = browsable();
        let albums = browse(&db, BrowseKind::Albums);

        assert_eq!(
            albums.last().unwrap().key,
            None,
            "the untagged group belongs at the end, not the top"
        );
        // The genuinely untagged row and the empty-string one are the same
        // group: `''` is an absent tag, not an album named nothing.
        assert_eq!(albums.last().unwrap().track_count, 2);
        assert_eq!(
            keys(&albums).iter().filter(|k| k.is_none()).count(),
            1,
            "there must be exactly one untagged group"
        );
    }

    #[test]
    fn totals_and_covers_come_from_the_group() {
        let (_dir, db) = browsable();
        let albums = browse(&db, BrowseKind::Albums);

        let comp = albums
            .iter()
            .find(|g| g.key.as_deref() == Some("Comp"))
            .unwrap();
        assert_eq!(comp.duration_ms, 3000);
        assert_eq!(comp.year, Some(2001));
        // One track of the three has no cover; the album still has one.
        assert_eq!(comp.cover_hash.as_deref(), Some("ca"));
    }

    #[test]
    fn artists_and_genres_group_on_their_own_columns() {
        let (_dir, db) = browsable();

        let artists = browse(&db, BrowseKind::Artists);
        assert_eq!(
            keys(&artists),
            [
                Some("Dio"),
                Some("Eve"),
                Some("Frank"),
                Some("Various Artists"),
                None
            ],
        );
        assert!(
            artists.iter().all(|g| g.secondary.is_none()),
            "only albums have a second key"
        );

        let genres = browse(&db, BrowseKind::Genres);
        assert_eq!(
            keys(&genres),
            [Some("Jazz"), Some("Pop"), Some("Rock"), None],
        );
    }

    #[test]
    fn a_search_narrows_the_browse_list_the_way_it_narrows_rows() {
        let (_dir, db) = browsable();
        let conn = db.conn().unwrap();

        let albums = browse_groups(
            &conn,
            &TrackQuery {
                search: Some("Dio".to_owned()),
                ..Default::default()
            },
            BrowseKind::Albums,
        )
        .unwrap();

        assert_eq!(keys(&albums), [Some("Double")]);
        assert_eq!(albums[0].track_count, 2);
    }

    #[test]
    fn drilling_into_an_album_shows_exactly_its_tracks() {
        let (_dir, db) = browsable();
        let conn = db.conn().unwrap();

        let query = TrackQuery {
            browse: Some(BrowseFilter {
                kind: BrowseKind::Albums,
                key: Some("Double".to_owned()),
                secondary: Some("Dio".to_owned()),
            }),
            sort_by: SortField::Path,
            limit: 100,
            ..Default::default()
        };

        // Not the Eve album of the same name.
        assert_eq!(
            paths(query_tracks(&conn, &query).unwrap()),
            ["/b/4.mp3", "/b/5.mp3"]
        );
        assert_eq!(count_tracks(&conn, &query).unwrap(), 2);
    }

    #[test]
    fn drilling_into_the_untagged_group_selects_it_rather_than_everything() {
        let (_dir, db) = browsable();
        let conn = db.conn().unwrap();

        // The case `= ?` would get wrong: a bound NULL equals nothing, so this
        // would come back empty, and a dropped clause would return the library.
        let query = TrackQuery {
            browse: Some(BrowseFilter {
                kind: BrowseKind::Albums,
                key: None,
                secondary: None,
            }),
            sort_by: SortField::Path,
            limit: 100,
            ..Default::default()
        };

        assert_eq!(
            paths(query_tracks(&conn, &query).unwrap()),
            ["/b/8.mp3", "/b/9.mp3"]
        );
    }

    #[test]
    fn the_group_list_ignores_a_drill_in_that_is_already_open() {
        let (_dir, db) = browsable();
        let conn = db.conn().unwrap();

        // Otherwise opening an album would collapse the album list to that one
        // album, and there would be no way back.
        let groups = browse_groups(
            &conn,
            &TrackQuery {
                browse: Some(BrowseFilter {
                    kind: BrowseKind::Albums,
                    key: Some("Comp".to_owned()),
                    secondary: Some("Various Artists".to_owned()),
                }),
                ..Default::default()
            },
            BrowseKind::Albums,
        )
        .unwrap();

        assert!(groups.len() > 1, "the album list must not filter itself");
    }

    #[test]
    fn browsing_inside_a_playlist_covers_only_its_members() {
        let (_dir, db, playlist_id) = with_playlist();
        let conn = db.conn().unwrap();

        let groups = browse_groups(
            &conn,
            &TrackQuery {
                playlist_id: Some(playlist_id),
                ..Default::default()
            },
            BrowseKind::Albums,
        )
        .unwrap();

        let total: u32 = groups.iter().map(|g| g.track_count).sum();
        assert_eq!(
            total, 3,
            "the playlist has three tracks, so its albums hold three"
        );
    }

    #[test]
    fn a_browse_filter_composes_with_a_search_rather_than_replacing_it() {
        let (_dir, db) = browsable();
        let conn = db.conn().unwrap();

        let query = TrackQuery {
            browse: Some(BrowseFilter {
                kind: BrowseKind::Genres,
                key: Some("Rock".to_owned()),
                secondary: None,
            }),
            search: Some("Dio".to_owned()),
            sort_by: SortField::Path,
            limit: 100,
            ..Default::default()
        };

        // Rock holds three tracks; only the two Dio ones also match the search.
        assert_eq!(
            paths(query_tracks(&conn, &query).unwrap()),
            ["/b/4.mp3", "/b/5.mp3"]
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

    #[test]
    fn a_selection_is_split_into_the_releases_it_covers() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        let ids: Vec<i64> = all_track_ids(&conn, &TrackQuery::default()).unwrap();

        let selections = release_selections(&conn, &ids).unwrap();

        assert_eq!(selections.len(), 3, "two albums and the untagged file");
        assert_eq!(
            selections
                .iter()
                .map(|s| (s.artist.clone(), s.album.clone(), s.track_ids.len()))
                .collect::<Vec<_>>(),
            vec![
                // Untagged first, which is where SQLite sorts a NULL and
                // where the release worth looking up most belongs.
                (None, None, 1),
                (
                    Some("Grizzly Bear".to_owned()),
                    Some("Shields".to_owned()),
                    2
                ),
                (Some("Guitar".to_owned()), Some("Tokyo".to_owned()), 2),
            ]
        );
    }

    #[test]
    fn nothing_selected_is_no_releases_rather_than_every_release() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();

        assert!(release_selections(&conn, &[]).unwrap().is_empty());
    }

    /// The rule the identifiers depend on: a lookup started from three files
    /// of a release still has to see the whole release.
    #[test]
    fn a_partial_selection_still_names_every_file_of_its_release() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        let one: i64 = conn
            .query_row("SELECT id FROM tracks WHERE path = '/m/3.mp3'", [], |row| {
                row.get(0)
            })
            .unwrap();

        let selections = release_selections(&conn, &[one]).unwrap();
        assert_eq!(selections[0].track_ids.len(), 1);

        let members = release_members(
            &conn,
            selections[0].album.as_deref(),
            selections[0].artist.as_deref(),
        )
        .unwrap();
        assert_eq!(members.len(), 2);
        assert_eq!(
            members.iter().map(|m| m.duration_ms).collect::<Vec<_>>(),
            vec![330_000, 271_000]
        );
    }

    #[test]
    fn an_untagged_release_is_matched_on_its_nulls() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();

        assert_eq!(release_members(&conn, None, None).unwrap().len(), 1);
    }

    #[test]
    fn a_missing_file_is_not_part_of_the_release_to_write() {
        let (_dir, db) = seeded();
        let conn = db.conn().unwrap();
        conn.execute(
            "UPDATE tracks SET missing_since = 1 WHERE path = '/m/4.mp3'",
            [],
        )
        .unwrap();

        let members = release_members(&conn, Some("Shields"), Some("Grizzly Bear")).unwrap();

        assert_eq!(members.len(), 1);
    }

    /// One release spelled two ways, and one artist spelled two ways, which is
    /// what the browse view drew as two tiles each.
    fn mixed_cased() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();

        // (path, artist, album, track)
        let rows = [
            // The album differs in case, the artist does not.
            ("/c/1.mp3", "In Flames", "A Sense Of Purpose", 1),
            ("/c/2.mp3", "In Flames", "A Sense of Purpose", 2),
            // The artist differs in case, the album does not.
            ("/c/3.mp3", "ASP", "Requiembryo", 1),
            ("/c/4.mp3", "asp", "Requiembryo", 2),
        ];
        for (path, artist, album, track) in rows {
            conn.execute(
                "INSERT INTO tracks (path, mtime, size, duration_ms, title, artist, album_artist,
                                     album, track_no, added_at)
                 VALUES (?1, 1, 1, 1000, 'T', ?2, ?2, ?3, ?4, 0)",
                rusqlite::params![path, artist, album, track],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, added_at) VALUES ('/c/5.mp3', 1, 1, 0)",
            [],
        )
        .unwrap();
        (dir, db)
    }

    #[test]
    fn a_pair_differing_only_in_album_case_is_one_tile() {
        let (_dir, db) = mixed_cased();
        let albums = browse(&db, BrowseKind::Albums);

        let folded: Vec<_> = albums
            .iter()
            .filter(|g| g.secondary.as_deref() == Some("In Flames"))
            .collect();

        assert_eq!(folded.len(), 1, "two casings of one album are one tile");
        assert_eq!(folded[0].track_count, 2);
    }

    #[test]
    fn a_pair_differing_only_in_artist_case_is_one_tile() {
        let (_dir, db) = mixed_cased();

        let albums = browse(&db, BrowseKind::Albums);
        let folded: Vec<_> = albums
            .iter()
            .filter(|g| g.key.as_deref() == Some("Requiembryo"))
            .collect();
        assert_eq!(folded.len(), 1, "the secondary key folds too");
        assert_eq!(folded[0].track_count, 2);

        // And on the artists tab, where that same casing pair is the key.
        assert_eq!(
            keys(&browse(&db, BrowseKind::Artists)),
            [Some("ASP"), Some("In Flames"), None],
        );
    }

    #[test]
    fn a_folded_group_is_labelled_with_one_of_its_casings() {
        let (_dir, db) = mixed_cased();
        let albums = browse(&db, BrowseKind::Albums);

        // `min()` is a binary comparison, so the uppercase variant wins. Which
        // one is arbitrary; that it is the same one every time is not, because
        // it is the React key the grid rows are identified by.
        assert_eq!(albums[0].key.as_deref(), Some("A Sense Of Purpose"));
        assert_eq!(albums[1].secondary.as_deref(), Some("ASP"));
    }

    #[test]
    fn drilling_into_a_folded_tile_shows_both_casings() {
        let (_dir, db) = mixed_cased();
        let conn = db.conn().unwrap();
        let drill = |kind, key: &str, secondary: Option<&str>| {
            paths(
                query_tracks(
                    &conn,
                    &TrackQuery {
                        browse: Some(BrowseFilter {
                            kind,
                            key: Some(key.to_owned()),
                            secondary: secondary.map(str::to_owned),
                        }),
                        sort_by: SortField::Path,
                        limit: 100,
                        ..Default::default()
                    },
                )
                .unwrap(),
            )
        };

        // The tile carries the label `min()` picked, so the other casing's
        // tracks are only reachable if the filter folds case as well.
        assert_eq!(
            drill(BrowseKind::Albums, "A Sense Of Purpose", Some("In Flames")),
            ["/c/1.mp3", "/c/2.mp3"]
        );
        assert_eq!(
            drill(BrowseKind::Albums, "Requiembryo", Some("ASP")),
            ["/c/3.mp3", "/c/4.mp3"]
        );
        assert_eq!(
            drill(BrowseKind::Artists, "ASP", None),
            ["/c/3.mp3", "/c/4.mp3"]
        );
    }

    #[test]
    fn folding_case_leaves_the_untagged_group_alone() {
        let (_dir, db) = mixed_cased();
        let albums = browse(&db, BrowseKind::Albums);

        // `nullif` still runs before the collation, so an absent tag is still
        // one group and still sorts last.
        assert_eq!(albums.last().unwrap().key, None);
        assert_eq!(albums.last().unwrap().track_count, 1);
        assert_eq!(albums.len(), 3);
    }

    #[test]
    fn a_release_spelled_two_ways_is_looked_up_once() {
        let (_dir, db) = mixed_cased();
        let conn = db.conn().unwrap();
        let ids: Vec<i64> = all_track_ids(&conn, &TrackQuery::default()).unwrap();

        let selections = release_selections(&conn, &ids).unwrap();

        // One request a second: an unfolded pair costs two of them for one
        // release and offers the user the same release twice.
        assert_eq!(
            selections
                .iter()
                .map(|s| s.track_ids.len())
                .collect::<Vec<_>>(),
            vec![1, 2, 2],
            "the untagged file, then one selection per release"
        );
    }

    #[test]
    fn every_casing_of_a_release_is_written_its_identity() {
        let (_dir, db) = mixed_cased();
        let conn = db.conn().unwrap();

        // Handed either casing: `with_identity` writes the MBIDs to what comes
        // back, so half a release here is half a release identified.
        for artist in ["ASP", "asp"] {
            assert_eq!(
                release_members(&conn, Some("requiembryo"), Some(artist))
                    .unwrap()
                    .len(),
                2,
                "asking as {artist:?} must still name the whole release"
            );
        }
    }

    /// The walk the unattended pass surveys the library with. A release tagged
    /// two ways is one release here too - unfolded it would be filed into two
    /// folders, and each sweep would move it back into the other.
    #[test]
    fn the_walk_groups_a_release_tagged_two_ways_as_one() {
        let (_dir, db) = mixed_cased();
        let conn = db.conn().unwrap();

        let mut seen = Vec::new();
        for_each_release(&conn, |album, artist, files| {
            seen.push((album, artist, files.len()));
        })
        .unwrap();

        assert_eq!(
            seen.iter()
                .map(|(album, artist, count)| (album.as_deref(), artist.as_deref(), *count))
                .collect::<Vec<_>>(),
            [
                // Artist first, which is the order `lookup::pending` reads
                // releases in.
                (Some("Requiembryo"), Some("ASP"), 2),
                (Some("A Sense Of Purpose"), Some("In Flames"), 2),
                // The untagged file, where the grid puts it: last, and one
                // release of its own rather than one per file.
                (None, None, 1),
            ],
            "one group per release, in the casing of its first row"
        );
    }

    /// What the pass asks after a lookup has rewritten every file of a release
    /// and the key it arrived under has stopped naming anything.
    #[test]
    fn a_track_says_which_release_it_now_belongs_to() {
        let (_dir, db) = mixed_cased();
        let conn = db.conn().unwrap();
        let id: i64 = conn
            .query_row("SELECT id FROM tracks WHERE path = '/c/3.mp3'", [], |row| {
                row.get(0)
            })
            .unwrap();

        conn.execute(
            "UPDATE tracks SET album = 'Zutiefst', album_artist = 'ASP' WHERE id = ?1",
            [id],
        )
        .unwrap();

        assert_eq!(
            release_of(&conn, id).unwrap(),
            Some((Some("Zutiefst".to_owned()), Some("ASP".to_owned())))
        );
        assert_eq!(release_of(&conn, -1).unwrap(), None);
    }
}
