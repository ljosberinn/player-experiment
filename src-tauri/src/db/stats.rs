//! The aggregates behind the Statistics view.
//!
//! Listening aggregates read `plays` through a [`ListenQuery`]. Library ones
//! read `tracks` through the [`TrackQuery`] every other view uses, via
//! [`query::scope`], so a panel narrows to a view or a playlist without a
//! second notion of what a view contains.
//!
//! # Local time
//!
//! Every bucket is cut in local time. Under UTC, listening at 23:00 lands on
//! tomorrow's Tuesday, which ruins the hour-of-day panel specifically. DST
//! leaves two irregular days a year - one hour short, one hour counted twice -
//! and that is left as it is.
//!
//! # No rollups
//!
//! A quarter of a million plays is one `GROUP BY`. A materialized aggregate
//! would buy nothing and would owe an invalidation path.

use std::collections::HashMap;

use rusqlite::{types::ToSql, Connection};

use crate::db::genres::{self, Tree};
use crate::db::query::{self, GROUP_ARTIST, MAX_LIMIT};
use crate::error::AppResult;
use crate::model::{
    AlbumBitrate, GenreBreakdown, GenreSlice, HistogramBin, HistogramField, LibraryTotals,
    ListenDimension, ListenQuery, ListenTotals, Play, Streaks, TagHealth, TimeBucket, TimeCount,
    TopEntry, TrackQuery,
};

/// The modifiers that turn a unix-seconds column into local time.
const LOCAL: &str = "'unixepoch', 'localtime'";

/// A play's length where one is known.
///
/// An imported scrobble carries none, so the matched file's stands in. Zero
/// is a file whose length could not be read, not a zero-length song.
const DURATION: &str = "coalesce(nullif(plays.duration_ms, 0), nullif(tracks.duration_ms, 0))";

/// The FROM/WHERE a [`ListenQuery`] narrows plays to.
///
/// Always joins `tracks`: SQLite drops a LEFT JOIN on a primary key whose
/// columns nothing reads, so the aggregates that never look at a file do not
/// pay for it.
struct Plays {
    conditions: Vec<String>,
    params: Vec<Box<dyn ToSql>>,
}

impl Plays {
    fn new(conn: &Connection, query: &ListenQuery) -> AppResult<Self> {
        let mut conditions = Vec::new();
        let mut params: Vec<Box<dyn ToSql>> = Vec::new();

        if let Some(range) = query.range {
            conditions.push("plays.started_at >= ? AND plays.started_at < ?".to_owned());
            params.push(Box::new(range.from));
            params.push(Box::new(range.to));
        }
        if let Some(artist) = &query.artist {
            conditions.push("plays.artist = ? COLLATE NOCASE".to_owned());
            params.push(Box::new(artist.clone()));
        }
        if let Some(album) = &query.album {
            conditions.push("plays.album = ? COLLATE NOCASE".to_owned());
            params.push(Box::new(album.clone()));
        }
        if let Some(genre) = &query.genre {
            conditions.push("tracks.genre IN (SELECT value FROM json_each(?))".to_owned());
            params.push(Box::new(genres::members(conn, genre)?));
        }
        match query.owned {
            Some(true) => conditions.push("plays.track_id IS NOT NULL".to_owned()),
            Some(false) => conditions.push("plays.track_id IS NULL".to_owned()),
            None => {}
        }
        match query.loved {
            Some(true) => conditions
                .push("plays.match_key IN (SELECT match_key FROM lastfm_loved)".to_owned()),
            Some(false) => conditions
                .push("plays.match_key NOT IN (SELECT match_key FROM lastfm_loved)".to_owned()),
            None => {}
        }

        Ok(Self { conditions, params })
    }

    fn clause(&self, extra: &[&str]) -> String {
        let mut sql = String::from("FROM plays LEFT JOIN tracks ON tracks.id = plays.track_id");
        let conditions: Vec<&str> = self
            .conditions
            .iter()
            .map(String::as_str)
            .chain(extra.iter().copied())
            .collect();
        if !conditions.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&conditions.join(" AND "));
        }
        sql
    }

    fn params<'a>(&'a self, extra: &[&'a dyn ToSql]) -> Vec<&'a dyn ToSql> {
        self.params
            .iter()
            .map(|param| param.as_ref())
            .chain(extra.iter().copied())
            .collect()
    }
}

/// The expression naming the bucket `column` falls in, as its first local day.
fn bucket_sql(column: &str, bucket: TimeBucket) -> String {
    match bucket {
        TimeBucket::Day => format!("date({column}, {LOCAL})"),
        // `weekday 0` moves forward to Sunday, or stays on one, so six days
        // back from it is always the Monday that opens the week.
        TimeBucket::Week => format!("date({column}, {LOCAL}, 'weekday 0', '-6 days')"),
        TimeBucket::Month => format!("strftime('%Y-%m-01', {column}, {LOCAL})"),
        TimeBucket::Year => format!("strftime('%Y-01-01', {column}, {LOCAL})"),
    }
}

fn time_series(conn: &Connection, sql: &str, params: &[&dyn ToSql]) -> AppResult<Vec<TimeCount>> {
    let mut statement = conn.prepare(sql)?;
    let series = statement
        .query_map(params, |row| {
            Ok(TimeCount {
                start: row.get(0)?,
                count: row.get::<_, i64>(1)? as u32,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(series)
}

/// The Listening tab's tiles, and the counts a panel needs to say what share
/// of the plays it covers.
pub fn listen_totals(conn: &Connection, query: &ListenQuery) -> AppResult<ListenTotals> {
    let plays = Plays::new(conn, query)?;
    // `lower()` rather than `COLLATE NOCASE` for the distinct counts, because
    // an album is two columns and a concatenation has no collation. Both fold
    // ASCII only, so these agree with the groups `top` draws.
    let sql = format!(
        "SELECT count(*),
                count(DISTINCT lower(nullif(plays.artist, ''))),
                count(DISTINCT lower(nullif(plays.album, '')) || char(31) || lower(plays.artist)),
                count(DISTINCT nullif(plays.match_key, '')),
                count(DISTINCT date(plays.started_at, {LOCAL})),
                coalesce(sum({DURATION}), 0),
                count(plays.track_id),
                count(nullif(tracks.genre, '')),
                count({DURATION}),
                min(plays.started_at),
                max(plays.started_at)
         {}",
        plays.clause(&[])
    );

    let totals = conn.query_row(&sql, plays.params(&[]).as_slice(), |row| {
        Ok(ListenTotals {
            plays: row.get::<_, i64>(0)? as u32,
            artists: row.get::<_, i64>(1)? as u32,
            albums: row.get::<_, i64>(2)? as u32,
            tracks: row.get::<_, i64>(3)? as u32,
            days: row.get::<_, i64>(4)? as u32,
            duration_ms: row.get(5)?,
            owned: row.get::<_, i64>(6)? as u32,
            with_genre: row.get::<_, i64>(7)? as u32,
            timed: row.get::<_, i64>(8)? as u32,
            first_at: row.get(9)?,
            last_at: row.get(10)?,
        })
    })?;
    Ok(totals)
}

/// Plays newest first, a page at a time. `listen_totals` is the count.
pub fn recent_plays(
    conn: &Connection,
    query: &ListenQuery,
    offset: u32,
    limit: u32,
) -> AppResult<Vec<Play>> {
    let plays = Plays::new(conn, query)?;
    let sql = format!(
        "SELECT plays.id, plays.started_at, plays.artist, plays.title, plays.album, plays.track_id
         {} ORDER BY plays.started_at DESC, plays.id DESC LIMIT ? OFFSET ?",
        plays.clause(&[])
    );
    let limit = limit.min(MAX_LIMIT);

    let mut statement = conn.prepare(&sql)?;
    let rows = statement
        .query_map(plays.params(&[&limit, &offset]).as_slice(), |row| {
            Ok(Play {
                id: row.get(0)?,
                started_at: row.get(1)?,
                artist: row.get(2)?,
                title: row.get(3)?,
                album: row.get(4)?,
                track_id: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// The most played artists, albums, tracks or genres.
///
/// Artists and albums group case-insensitively and are labelled with one
/// casing, as `browse_groups` does. A track is its `match_key`, so the album
/// cut and the `(feat. …)` spelling are one entry. A blank is never an entry:
/// the untagged are not a band.
pub fn top(
    conn: &Connection,
    query: &ListenQuery,
    dimension: ListenDimension,
    limit: u32,
) -> AppResult<Vec<TopEntry>> {
    let limit = limit.min(MAX_LIMIT);
    let (key, secondary, group, present) = match dimension {
        ListenDimension::Genre => return top_genres(conn, query, limit),
        ListenDimension::Artist => (
            "min(plays.artist)",
            "NULL",
            "plays.artist COLLATE NOCASE",
            "plays.artist <> ''",
        ),
        ListenDimension::Album => (
            "min(plays.album)",
            "min(plays.artist)",
            "plays.album COLLATE NOCASE, plays.artist COLLATE NOCASE",
            "plays.album <> ''",
        ),
        ListenDimension::Track => (
            "min(plays.title)",
            "min(plays.artist)",
            "plays.match_key",
            "plays.match_key <> ''",
        ),
    };

    let plays = Plays::new(conn, query)?;
    let sql = format!(
        "SELECT {key} AS entry, {secondary}, count(*) AS heard {} GROUP BY {group}
         ORDER BY heard DESC, entry COLLATE NOCASE ASC LIMIT ?",
        plays.clause(&[present])
    );

    let mut statement = conn.prepare(&sql)?;
    let entries = statement
        .query_map(plays.params(&[&limit]).as_slice(), |row| {
            Ok(TopEntry {
                key: row.get(0)?,
                secondary: row.get(1)?,
                plays: row.get::<_, i64>(2)? as u32,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(entries)
}

/// Genres are ranked by resolved label, so "DSBM" and "Depressive Black
/// Metal" are one entry. Only a matched play has a genre;
/// `ListenTotals::with_genre` is the share this covers.
fn top_genres(conn: &Connection, query: &ListenQuery, limit: u32) -> AppResult<Vec<TopEntry>> {
    let plays = Plays::new(conn, query)?;
    let sql = format!(
        "SELECT tracks.genre, count(*) {} GROUP BY tracks.genre",
        plays.clause(&["tracks.genre <> ''"])
    );

    let tree = Tree::load(conn)?;
    let mut heard: HashMap<String, u32> = HashMap::new();
    let mut statement = conn.prepare(&sql)?;
    let mut rows = statement.query(plays.params(&[]).as_slice())?;
    while let Some(row) = rows.next()? {
        let raw: String = row.get(0)?;
        *heard.entry(tree.resolve(&raw).label).or_default() += row.get::<_, i64>(1)? as u32;
    }

    let mut entries: Vec<TopEntry> = heard
        .into_iter()
        .map(|(key, plays)| TopEntry {
            key,
            secondary: None,
            plays,
        })
        .collect();
    entries.sort_by(|a, b| b.plays.cmp(&a.plays).then_with(|| a.key.cmp(&b.key)));
    entries.truncate(limit as usize);
    Ok(entries)
}

pub fn plays_over_time(
    conn: &Connection,
    query: &ListenQuery,
    bucket: TimeBucket,
) -> AppResult<Vec<TimeCount>> {
    let plays = Plays::new(conn, query)?;
    let sql = format!(
        "SELECT {} AS start, count(*) {} GROUP BY start ORDER BY start",
        bucket_sql("plays.started_at", bucket),
        plays.clause(&[])
    );
    time_series(conn, &sql, &plays.params(&[]))
}

/// Plays per weekday and hour: 168 counts, Monday 00:00 first.
///
/// Hour-of-day is this summed down each column, which is why there is no
/// separate aggregate for it.
pub fn week_clock(conn: &Connection, query: &ListenQuery) -> AppResult<Vec<u32>> {
    let plays = Plays::new(conn, query)?;
    // One conversion per row rather than one per field: the weekday and the
    // hour come out of a single `strftime` and are split apart here.
    let sql = format!(
        "SELECT strftime('%w %H', plays.started_at, {LOCAL}) AS cell, count(*) {} GROUP BY cell",
        plays.clause(&[])
    );

    let mut clock = vec![0_u32; 7 * 24];
    let mut statement = conn.prepare(&sql)?;
    let mut rows = statement.query(plays.params(&[]).as_slice())?;
    while let Some(row) = rows.next()? {
        let cell: String = row.get(0)?;
        let (Some(weekday), Some(hour)) = (
            cell.get(..1).and_then(|w| w.parse::<usize>().ok()),
            cell.get(2..).and_then(|h| h.parse::<usize>().ok()),
        ) else {
            continue;
        };
        // `%w` counts from Sunday.
        clock[(weekday + 6) % 7 * 24 + hour] = row.get::<_, i64>(1)? as u32;
    }
    Ok(clock)
}

/// How many artists were heard for the first time in each bucket.
///
/// **The range narrows the result, not the plays.** Every other filter picks
/// the plays; each artist's first one is then found over all time, or "new
/// this year" would be every artist heard this year.
pub fn firsts(
    conn: &Connection,
    query: &ListenQuery,
    bucket: TimeBucket,
) -> AppResult<Vec<TimeCount>> {
    let plays = Plays::new(
        conn,
        &ListenQuery {
            range: None,
            ..query.clone()
        },
    )?;
    let inner = format!(
        "SELECT min(plays.started_at) AS first {} GROUP BY plays.artist COLLATE NOCASE",
        plays.clause(&["plays.artist <> ''"])
    );

    let (from, to) = query
        .range
        .map_or((i64::MIN, i64::MAX), |range| (range.from, range.to));
    let sql = format!(
        "SELECT {} AS start, count(*) FROM ({inner}) WHERE first >= ? AND first < ?
         GROUP BY start ORDER BY start",
        bucket_sql("first", bucket)
    );
    time_series(conn, &sql, &plays.params(&[&from, &to]))
}

/// The current and the longest run of consecutive local days with a play.
///
/// `now` is a parameter, as it is for `smart::compile`, so the current streak
/// is a function of its inputs.
pub fn streaks(conn: &Connection, query: &ListenQuery, now: i64) -> AppResult<Streaks> {
    let plays = Plays::new(conn, query)?;
    // Julian day numbers make "consecutive" an integer step. A date's is x.5,
    // so the cast lands every day on its own integer.
    let sql = format!(
        "SELECT CAST(julianday(day) AS INTEGER), day
         FROM (SELECT DISTINCT date(plays.started_at, {LOCAL}) AS day {})
         ORDER BY day",
        plays.clause(&[])
    );
    let today: i64 = conn.query_row(
        &format!("SELECT CAST(julianday(date(?, {LOCAL})) AS INTEGER)"),
        [now],
        |row| row.get(0),
    )?;

    let mut streaks = Streaks::default();
    let mut run = 0_u32;
    let mut run_from = String::new();
    let mut previous: Option<i64> = None;

    let mut statement = conn.prepare(&sql)?;
    let mut rows = statement.query(plays.params(&[]).as_slice())?;
    while let Some(row) = rows.next()? {
        let number: i64 = row.get(0)?;
        let day: String = row.get(1)?;
        if previous == Some(number - 1) {
            run += 1;
        } else {
            run = 1;
            run_from.clone_from(&day);
        }
        // `>=` so a tie goes to the more recent run.
        if run >= streaks.longest {
            streaks.longest = run;
            streaks.longest_from = Some(run_from.clone());
            streaks.longest_to = Some(day);
        }
        previous = Some(number);
    }

    // A run that ended yesterday is still current: today is not over.
    if previous.is_some_and(|last| last == today || last == today - 1) {
        streaks.current = run;
    }
    Ok(streaks)
}

/// The Library tab's tiles.
pub fn library_totals(conn: &Connection, query: &TrackQuery) -> AppResult<LibraryTotals> {
    let scope = query::scope(conn, query)?;
    // Keyed as `browse_groups` keys them, less the untagged group: a tile
    // counting "no album" as an album would be off by one in every library.
    let sql = format!(
        "SELECT count(*),
                count(DISTINCT lower({GROUP_ARTIST})),
                count(DISTINCT lower(nullif(tracks.album, '')) || char(31)
                               || coalesce(lower({GROUP_ARTIST}), '')),
                coalesce(sum(tracks.duration_ms), 0),
                coalesce(sum(tracks.size), 0),
                count(tracks.missing_since)
         {}",
        scope.from_where
    );

    let totals = conn.query_row(
        &sql,
        rusqlite::params_from_iter(scope.params.iter()),
        |row| {
            Ok(LibraryTotals {
                tracks: row.get::<_, i64>(0)? as u32,
                artists: row.get::<_, i64>(1)? as u32,
                albums: row.get::<_, i64>(2)? as u32,
                duration_ms: row.get(3)?,
                bytes: row.get(4)?,
                missing: row.get::<_, i64>(5)? as u32,
            })
        },
    )?;
    Ok(totals)
}

/// How many tracks fall in each bin of `field`, lowest first.
pub fn histogram(
    conn: &Connection,
    query: &TrackQuery,
    field: HistogramField,
) -> AppResult<Vec<HistogramBin>> {
    let (column, width) = match field {
        HistogramField::Bitrate => ("tracks.bitrate", 32),
        HistogramField::SampleRate => ("tracks.sample_rate", 1),
        HistogramField::Year => ("tracks.year", 1),
        HistogramField::Duration => ("nullif(tracks.duration_ms, 0)", 60_000),
    };
    let scope = query::scope(conn, query)?;
    let sql = format!(
        "SELECT {column} / {width} * {width} AS bin, count(*) {}
         GROUP BY bin HAVING bin IS NOT NULL ORDER BY bin",
        scope.from_where
    );

    let mut statement = conn.prepare(&sql)?;
    let bins = statement
        .query_map(rusqlite::params_from_iter(scope.params.iter()), |row| {
            Ok(HistogramBin {
                value: row.get(0)?,
                count: row.get::<_, i64>(1)? as u32,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(bins)
}

/// Albums by mean bitrate, worst first: the re-download list.
///
/// Albums are keyed as `browse_groups` keys them. The untagged group is left
/// out - it is not a thing anyone can download again.
pub fn worst_by_bitrate(
    conn: &Connection,
    query: &TrackQuery,
    limit: u32,
) -> AppResult<Vec<AlbumBitrate>> {
    let mut scope = query::scope(conn, query)?;
    let sql = format!(
        "SELECT min(nullif(tracks.album, '')) AS album, min({GROUP_ARTIST}), count(*),
                CAST(round(avg(tracks.bitrate)) AS INTEGER) AS mean, min(tracks.cover_hash)
         {}
         GROUP BY nullif(tracks.album, '') COLLATE NOCASE, {GROUP_ARTIST} COLLATE NOCASE
         HAVING album IS NOT NULL AND mean IS NOT NULL
         ORDER BY mean ASC, album COLLATE NOCASE ASC
         LIMIT ?",
        scope.from_where
    );
    scope.params.push(Box::new(limit.min(MAX_LIMIT)));

    let mut statement = conn.prepare(&sql)?;
    let albums = statement
        .query_map(rusqlite::params_from_iter(scope.params.iter()), |row| {
            Ok(AlbumBitrate {
                album: row.get(0)?,
                artist: row.get(1)?,
                tracks: row.get::<_, i64>(2)? as u32,
                mean_bitrate: row.get(3)?,
                cover_hash: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(albums)
}

/// One level of the genre donut: `parent`'s children, each counting every
/// track at or below it, or the roots when `parent` is `None`.
///
/// Walks the primary parent and the overrides - the tree [`Tree`] resolves -
/// rather than `genre_edges`, which is the whole DAG and would count a
/// multi-parent genre under both.
pub fn genre_breakdown(
    conn: &Connection,
    query: &TrackQuery,
    parent: Option<&str>,
) -> AppResult<GenreBreakdown> {
    let tree = Tree::load(conn)?;
    let parent = parent.map(|parent| tree.resolve(parent).label);
    let scope = query::scope(conn, query)?;
    let sql = format!(
        "SELECT tracks.genre, count(*) {} GROUP BY tracks.genre",
        scope.from_where
    );

    let mut breakdown = GenreBreakdown {
        slices: Vec::new(),
        own: 0,
        untagged: 0,
    };
    let mut slices: HashMap<String, (u32, bool)> = HashMap::new();

    let mut statement = conn.prepare(&sql)?;
    let mut rows = statement.query(rusqlite::params_from_iter(scope.params.iter()))?;
    while let Some(row) = rows.next()? {
        let raw: Option<String> = row.get(0)?;
        let count = row.get::<_, i64>(1)? as u32;

        let Some(raw) = raw.filter(|raw| !raw.trim().is_empty()) else {
            if parent.is_none() {
                breakdown.untagged += count;
            }
            continue;
        };

        // `lineage` runs from the tag up to its root, so the slice is the
        // label one step below the drilled genre - or the root itself.
        let lineage = tree.lineage(&raw);
        let at = match &parent {
            None => lineage.len(),
            Some(parent) => match lineage.iter().position(|label| label == parent) {
                Some(at) => at,
                None => continue,
            },
        };
        if at == 0 {
            breakdown.own += count;
            continue;
        }

        let slice = slices.entry(lineage[at - 1].clone()).or_default();
        slice.0 += count;
        slice.1 |= at > 1;
    }

    breakdown.slices = slices
        .into_iter()
        .map(|(label, (tracks, has_children))| GenreSlice {
            parent_source: tree.resolve(&label).parent_source,
            label,
            tracks,
            has_children,
        })
        .collect();
    breakdown
        .slices
        .sort_by(|a, b| b.tracks.cmp(&a.tracks).then_with(|| a.label.cmp(&b.label)));
    Ok(breakdown)
}

/// Tracks added per bucket. Cumulative growth is the chart's running sum.
pub fn added_over_time(
    conn: &Connection,
    query: &TrackQuery,
    bucket: TimeBucket,
) -> AppResult<Vec<TimeCount>> {
    let scope = query::scope(conn, query)?;
    let sql = format!(
        "SELECT {} AS start, count(*) {} GROUP BY start ORDER BY start",
        bucket_sql("tracks.added_at", bucket),
        scope.from_where
    );
    let params: Vec<&dyn ToSql> = scope.params.iter().map(|param| param.as_ref()).collect();
    time_series(conn, &sql, &params)
}

/// How many tracks are missing each tag. An empty string is missing: it is
/// what a tag editor leaves behind when a field is cleared.
pub fn tag_health(conn: &Connection, query: &TrackQuery) -> AppResult<TagHealth> {
    let scope = query::scope(conn, query)?;
    let sql = format!(
        "SELECT count(*),
                count(*) - count(nullif(tracks.title, '')),
                count(*) - count(nullif(tracks.artist, '')),
                count(*) - count(nullif(tracks.album, '')),
                count(*) - count(nullif(tracks.album_artist, '')),
                count(*) - count(nullif(tracks.genre, '')),
                count(*) - count(tracks.year),
                count(*) - count(tracks.track_no),
                count(*) - count(tracks.cover_hash)
         {}",
        scope.from_where
    );

    let health = conn.query_row(
        &sql,
        rusqlite::params_from_iter(scope.params.iter()),
        |row| {
            let count = |at: usize| row.get::<_, i64>(at).map(|n| n as u32);
            Ok(TagHealth {
                tracks: count(0)?,
                title: count(1)?,
                artist: count(2)?,
                album: count(3)?,
                album_artist: count(4)?,
                genre: count(5)?,
                year: count(6)?,
                track_no: count(7)?,
                cover: count(8)?,
            })
        },
    )?;
    Ok(health)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{genres, plays::match_key, Db};
    use crate::model::{BrowseFilter, BrowseKind, TimeRange};

    fn open() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    /// A track row: every field a library aggregate reads, the rest defaulted.
    #[derive(Default)]
    struct File<'a> {
        artist: Option<&'a str>,
        title: Option<&'a str>,
        album: Option<&'a str>,
        album_artist: Option<&'a str>,
        genre: Option<&'a str>,
        year: Option<i64>,
        bitrate: Option<i64>,
        duration_ms: i64,
        added_at: i64,
    }

    fn add_file(conn: &Connection, file: File<'_>) -> i64 {
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, duration_ms, title, artist, album,
                                 album_artist, genre, year, bitrate, added_at)
             VALUES (hex(randomblob(8)), 0, 1000, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                file.duration_ms,
                file.title,
                file.artist,
                file.album,
                file.album_artist,
                file.genre,
                file.year,
                file.bitrate,
                file.added_at,
            ],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    /// A play as the import writes one: no duration, and linked only when
    /// `track_id` says so.
    fn add_play(
        conn: &Connection,
        started_at: i64,
        (artist, title, album): (&str, &str, Option<&str>),
        track_id: Option<i64>,
    ) {
        conn.execute(
            "INSERT INTO plays (started_at, source, artist, title, album, match_key, track_id)
             VALUES (?1, 'lastfm', ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                started_at,
                artist,
                title,
                album,
                match_key(artist, title),
                track_id
            ],
        )
        .unwrap();
    }

    /// Unix seconds for a local wall-clock time, by SQLite's own reckoning,
    /// so a test built on it holds in whatever zone it runs in.
    fn local(conn: &Connection, wall_clock: &str) -> i64 {
        conn.query_row(
            "SELECT CAST(strftime('%s', ?1, 'utc') AS INTEGER)",
            [wall_clock],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn all() -> ListenQuery {
        ListenQuery::default()
    }

    fn keys(entries: &[TopEntry]) -> Vec<(&str, u32)> {
        entries
            .iter()
            .map(|entry| (entry.key.as_str(), entry.plays))
            .collect()
    }

    fn series(counts: &[TimeCount]) -> Vec<(&str, u32)> {
        counts
            .iter()
            .map(|bucket| (bucket.start.as_str(), bucket.count))
            .collect()
    }

    /// `sum()` of no rows is NULL, and this is where every `coalesce` is
    /// actually asserted: each aggregate has to decode an empty database.
    #[test]
    fn every_aggregate_answers_an_empty_database() {
        let (_dir, conn) = open();
        let tracks = TrackQuery::default();

        assert_eq!(
            listen_totals(&conn, &all()).unwrap(),
            ListenTotals::default()
        );
        assert!(recent_plays(&conn, &all(), 0, 50).unwrap().is_empty());
        for dimension in [
            ListenDimension::Artist,
            ListenDimension::Album,
            ListenDimension::Track,
            ListenDimension::Genre,
        ] {
            assert!(top(&conn, &all(), dimension, 10).unwrap().is_empty());
        }
        for bucket in [
            TimeBucket::Day,
            TimeBucket::Week,
            TimeBucket::Month,
            TimeBucket::Year,
        ] {
            assert!(plays_over_time(&conn, &all(), bucket).unwrap().is_empty());
            assert!(firsts(&conn, &all(), bucket).unwrap().is_empty());
            assert!(added_over_time(&conn, &tracks, bucket).unwrap().is_empty());
        }
        assert_eq!(week_clock(&conn, &all()).unwrap(), vec![0; 168]);
        assert_eq!(streaks(&conn, &all(), 0).unwrap(), Streaks::default());

        assert_eq!(
            library_totals(&conn, &tracks).unwrap(),
            LibraryTotals::default()
        );
        for field in [
            HistogramField::Bitrate,
            HistogramField::SampleRate,
            HistogramField::Year,
            HistogramField::Duration,
        ] {
            assert!(histogram(&conn, &tracks, field).unwrap().is_empty());
        }
        assert!(worst_by_bitrate(&conn, &tracks, 10).unwrap().is_empty());
        assert_eq!(
            genre_breakdown(&conn, &tracks, None).unwrap(),
            GenreBreakdown {
                slices: Vec::new(),
                own: 0,
                untagged: 0
            }
        );
        assert_eq!(tag_health(&conn, &tracks).unwrap(), TagHealth::default());
    }

    /// Under UTC this lands on the wrong hour anywhere east of Greenwich and
    /// on Wednesday anywhere west of it. It only bites off UTC, which is why
    /// CI pins `TZ`.
    #[test]
    fn a_play_at_eleven_at_night_is_bucketed_on_its_own_local_day_and_hour() {
        let (_dir, conn) = open();
        // A Tuesday.
        let at = local(&conn, "2024-03-05 23:00:00");
        add_play(&conn, at, ("Blue Room", "Harbour", None), None);

        assert_eq!(
            series(&plays_over_time(&conn, &all(), TimeBucket::Day).unwrap()),
            [("2024-03-05", 1)]
        );
        let clock = week_clock(&conn, &all()).unwrap();
        assert_eq!(clock[24 + 23], 1, "Tuesday 23:00, Monday first");
        assert_eq!(clock.iter().sum::<u32>(), 1);
    }

    #[test]
    fn buckets_are_named_by_their_first_local_day() {
        let (_dir, conn) = open();
        for wall_clock in [
            "2024-03-06 12:00:00", // Wednesday
            "2024-03-10 12:00:00", // Sunday, the same week
            "2024-03-11 12:00:00", // Monday, the next one
            "2025-01-01 00:30:00",
        ] {
            let at = local(&conn, wall_clock);
            add_play(&conn, at, ("Blue Room", "Harbour", None), None);
        }

        assert_eq!(
            series(&plays_over_time(&conn, &all(), TimeBucket::Week).unwrap()),
            [("2024-03-04", 2), ("2024-03-11", 1), ("2024-12-30", 1)]
        );
        assert_eq!(
            series(&plays_over_time(&conn, &all(), TimeBucket::Month).unwrap()),
            [("2024-03-01", 3), ("2025-01-01", 1)]
        );
        assert_eq!(
            series(&plays_over_time(&conn, &all(), TimeBucket::Year).unwrap()),
            [("2024-01-01", 3), ("2025-01-01", 1)]
        );
    }

    /// A play with no file counts everywhere; only genre and an imported
    /// play's length need one, and the totals say how many had it.
    #[test]
    fn totals_count_every_play_and_say_how_many_a_file_backs() {
        let (_dir, conn) = open();
        let owned = add_file(
            &conn,
            File {
                artist: Some("Blue Room"),
                title: Some("Harbour"),
                genre: Some("Shoegaze"),
                duration_ms: 200_000,
                ..File::default()
            },
        );
        let day = local(&conn, "2024-03-05 12:00:00");
        add_play(
            &conn,
            day,
            ("Blue Room", "Harbour", Some("Tide")),
            Some(owned),
        );
        add_play(
            &conn,
            day + 60,
            ("BLUE ROOM", "Harbour (feat. Guest)", Some("tide")),
            Some(owned),
        );
        add_play(&conn, day + 86_400, ("Nobody", "Nothing", None), None);

        assert_eq!(
            listen_totals(&conn, &all()).unwrap(),
            ListenTotals {
                plays: 3,
                artists: 2,
                albums: 1,
                tracks: 2,
                days: 2,
                duration_ms: 400_000,
                owned: 2,
                with_genre: 2,
                timed: 2,
                first_at: Some(day),
                last_at: Some(day + 86_400),
            }
        );
    }

    #[test]
    fn top_lists_fold_spellings_and_leave_out_the_blank() {
        let (_dir, conn) = open();
        let dsbm = add_file(
            &conn,
            File {
                artist: Some("Blue Room"),
                title: Some("Harbour"),
                genre: Some("DSBM"),
                ..File::default()
            },
        );
        let spelled_out = add_file(
            &conn,
            File {
                artist: Some("Blue Room"),
                title: Some("Tide"),
                genre: Some("Depressive Black Metal"),
                ..File::default()
            },
        );
        add_play(&conn, 1, ("Blue Room", "Harbour", Some("Tide")), Some(dsbm));
        add_play(
            &conn,
            2,
            ("BLUE ROOM", "Harbour (feat. Guest)", Some("TIDE")),
            Some(dsbm),
        );
        add_play(
            &conn,
            3,
            ("Blue Room", "Tide", Some("Tide")),
            Some(spelled_out),
        );
        add_play(&conn, 4, ("Nobody", "Nothing", Some("Elsewhere")), None);
        add_play(&conn, 5, ("", "Untitled", None), None);

        assert_eq!(
            keys(&top(&conn, &all(), ListenDimension::Artist, 10).unwrap()),
            [("BLUE ROOM", 3), ("Nobody", 1)]
        );
        assert_eq!(
            keys(&top(&conn, &all(), ListenDimension::Album, 10).unwrap()),
            [("TIDE", 3), ("Elsewhere", 1)]
        );
        let tracks = top(&conn, &all(), ListenDimension::Track, 10).unwrap();
        assert_eq!(keys(&tracks), [("Harbour", 2), ("Nothing", 1), ("Tide", 1)]);
        assert_eq!(tracks[0].secondary.as_deref(), Some("BLUE ROOM"));
        assert_eq!(
            keys(&top(&conn, &all(), ListenDimension::Genre, 10).unwrap()),
            [("depressive black metal", 3)]
        );
        assert_eq!(
            keys(&top(&conn, &all(), ListenDimension::Artist, 1).unwrap()),
            [("BLUE ROOM", 3)],
            "the limit applies"
        );
    }

    #[test]
    fn recent_plays_page_newest_first() {
        let (_dir, conn) = open();
        for at in 1..=5 {
            add_play(&conn, at, ("Blue Room", &format!("Song {at}"), None), None);
        }

        let page = recent_plays(&conn, &all(), 1, 2).unwrap();
        assert_eq!(
            page.iter().map(|play| play.started_at).collect::<Vec<_>>(),
            [4, 3]
        );
    }

    #[test]
    fn each_listen_filter_narrows_and_they_compose() {
        let (_dir, conn) = open();
        let file = add_file(
            &conn,
            File {
                artist: Some("Blue Room"),
                title: Some("Harbour"),
                ..File::default()
            },
        );
        add_play(
            &conn,
            100,
            ("Blue Room", "Harbour", Some("Tide")),
            Some(file),
        );
        add_play(
            &conn,
            200,
            ("blue room", "Harbour", Some("Other")),
            Some(file),
        );
        add_play(&conn, 300, ("Nobody", "Nothing", Some("Tide")), None);

        let count = |query: ListenQuery| listen_totals(&conn, &query).unwrap().plays;
        let range = |from, to| Some(TimeRange { from, to });

        // Half-open: `to` is the first second outside.
        assert_eq!(
            count(ListenQuery {
                range: range(100, 300),
                ..all()
            }),
            2
        );
        assert_eq!(
            count(ListenQuery {
                range: range(200, 301),
                ..all()
            }),
            2
        );
        assert_eq!(
            count(ListenQuery {
                artist: Some("BLUE ROOM".into()),
                ..all()
            }),
            2
        );
        assert_eq!(
            count(ListenQuery {
                album: Some("tide".into()),
                ..all()
            }),
            2
        );
        assert_eq!(
            count(ListenQuery {
                owned: Some(true),
                ..all()
            }),
            2
        );
        assert_eq!(
            count(ListenQuery {
                owned: Some(false),
                ..all()
            }),
            1
        );
        conn.execute(
            "INSERT INTO lastfm_loved (match_key) VALUES (?1)",
            [match_key("Nobody", "Nothing")],
        )
        .unwrap();
        assert_eq!(
            count(ListenQuery {
                loved: Some(true),
                ..all()
            }),
            1
        );
        assert_eq!(
            count(ListenQuery {
                loved: Some(false),
                ..all()
            }),
            2
        );
        assert_eq!(
            count(ListenQuery {
                artist: Some("Blue Room".into()),
                album: Some("Tide".into()),
                range: range(0, 150),
                owned: Some(true),
                ..all()
            }),
            1
        );
    }

    /// The tree the donut draws: aliases, derived children and overrides
    /// included, `genre_edges` not consulted.
    #[test]
    fn the_genre_filter_takes_the_genre_and_everything_under_it() {
        let (_dir, conn) = open();
        for (at, genre) in [
            "Black Metal",
            "Atmospheric Black Metal",
            "DSBM",
            "Trve Kvlt Raw Black Metal",
            "Blackened Death Metal",
            "Jazz",
        ]
        .into_iter()
        .enumerate()
        {
            let file = add_file(
                &conn,
                File {
                    artist: Some("Blue Room"),
                    title: Some(genre),
                    genre: Some(genre),
                    ..File::default()
                },
            );
            add_play(&conn, at as i64, ("Blue Room", genre, None), Some(file));
        }
        add_play(&conn, 99, ("Nobody", "Nothing", None), None);

        let under = |genre: &str| {
            listen_totals(
                &conn,
                &ListenQuery {
                    genre: Some(genre.to_owned()),
                    ..all()
                },
            )
            .unwrap()
            .plays
        };

        assert_eq!(
            under("black metal"),
            5,
            "blackened death metal's primary parent is black metal"
        );
        assert_eq!(under("Depressive Black Metal"), 1, "the alias is the label");
        assert_eq!(under("raw black metal"), 1, "a derived child counts");
        assert_eq!(under("not a genre"), 0);

        genres::set_override(&conn, "blackened death metal", Some("death metal")).unwrap();
        assert_eq!(under("black metal"), 4, "an override moves it out");
        assert_eq!(under("death metal"), 1);
    }

    /// A cycle in the overrides, and the walk has to end anyway.
    ///
    /// Written straight into the table: `set_override` refuses to build one
    /// since 84e. A database from before that refusal, or edited by hand, can
    /// still hold one, and this filter is what walks it.
    #[test]
    fn a_cycle_of_overrides_does_not_hang_the_genre_filter() {
        let (_dir, conn) = open();
        conn.execute(
            "INSERT INTO genre_overrides (label, parent)
             VALUES ('black metal', 'atmospheric black metal')",
            [],
        )
        .unwrap();
        let file = add_file(
            &conn,
            File {
                artist: Some("Blue Room"),
                title: Some("Harbour"),
                genre: Some("Atmospheric Black Metal"),
                ..File::default()
            },
        );
        add_play(&conn, 1, ("Blue Room", "Harbour", None), Some(file));

        let query = ListenQuery {
            genre: Some("black metal".to_owned()),
            ..all()
        };
        assert_eq!(listen_totals(&conn, &query).unwrap().plays, 1);
    }

    /// "New this year" is the artists whose first play ever is this year, not
    /// every artist heard this year.
    #[test]
    fn firsts_find_the_first_play_over_all_time_and_only_then_apply_the_range() {
        let (_dir, conn) = open();
        let old = local(&conn, "2023-06-01 12:00:00");
        let new = local(&conn, "2024-06-01 12:00:00");
        add_play(&conn, old, ("Blue Room", "Harbour", None), None);
        add_play(&conn, new, ("BLUE ROOM", "Tide", None), None);
        add_play(&conn, new + 60, ("Nobody", "Nothing", None), None);

        let this_year = ListenQuery {
            range: Some(TimeRange {
                from: local(&conn, "2024-01-01 00:00:00"),
                to: local(&conn, "2025-01-01 00:00:00"),
            }),
            ..all()
        };
        assert_eq!(
            series(&firsts(&conn, &this_year, TimeBucket::Month).unwrap()),
            [("2024-06-01", 1)]
        );
        assert_eq!(
            series(&firsts(&conn, &all(), TimeBucket::Year).unwrap()),
            [("2023-01-01", 1), ("2024-01-01", 1)]
        );
    }

    #[test]
    fn streaks_count_consecutive_local_days() {
        let (_dir, conn) = open();
        let day = |n: u32| local(&conn, &format!("2024-03-{n:02} 21:00:00"));
        for n in [1, 2, 3, 5, 6] {
            add_play(&conn, day(n), ("Blue Room", "Harbour", None), None);
        }
        // Twice in a day is still one day.
        add_play(&conn, day(6) + 60, ("Blue Room", "Tide", None), None);

        let at = |n| streaks(&conn, &all(), day(n)).unwrap();
        assert_eq!(
            at(6),
            Streaks {
                current: 2,
                longest: 3,
                longest_from: Some("2024-03-01".to_owned()),
                longest_to: Some("2024-03-03".to_owned()),
            }
        );
        assert_eq!(at(7).current, 2, "today is not over yet");
        assert_eq!(at(8).current, 0);
    }

    #[test]
    fn library_totals_key_artists_and_albums_as_browsing_does() {
        let (_dir, conn) = open();
        for (artist, album_artist, album) in [
            ("Guest", Some("Blue Room"), Some("Tide")),
            ("Blue Room", None, Some("TIDE")),
            ("Nobody", None, None),
        ] {
            add_file(
                &conn,
                File {
                    artist: Some(artist),
                    album_artist,
                    album,
                    duration_ms: 1_000,
                    ..File::default()
                },
            );
        }

        assert_eq!(
            library_totals(&conn, &TrackQuery::default()).unwrap(),
            LibraryTotals {
                tracks: 3,
                artists: 2,
                albums: 1,
                duration_ms: 3_000,
                bytes: 3_000,
                missing: 0,
            }
        );
    }

    #[test]
    fn histograms_bin_and_leave_out_the_unknown() {
        let (_dir, conn) = open();
        for (bitrate, year) in [
            (Some(128), Some(1999)),
            (Some(140), Some(1999)),
            (Some(320), None),
            (None, Some(2001)),
        ] {
            add_file(
                &conn,
                File {
                    bitrate,
                    year,
                    duration_ms: 90_000,
                    ..File::default()
                },
            );
        }
        let bins = |field| {
            histogram(&conn, &TrackQuery::default(), field)
                .unwrap()
                .into_iter()
                .map(|bin| (bin.value, bin.count))
                .collect::<Vec<_>>()
        };

        assert_eq!(bins(HistogramField::Bitrate), [(128, 2), (320, 1)]);
        assert_eq!(bins(HistogramField::Year), [(1999, 2), (2001, 1)]);
        assert_eq!(bins(HistogramField::Duration), [(60_000, 4)]);
        assert!(bins(HistogramField::SampleRate).is_empty());
    }

    #[test]
    fn the_worst_albums_come_first_and_the_untagged_one_never() {
        let (_dir, conn) = open();
        for (album, bitrate) in [
            (Some("Tide"), 320),
            (Some("tide"), 256),
            (Some("Harbour"), 128),
            (None, 64),
        ] {
            add_file(
                &conn,
                File {
                    artist: Some("Blue Room"),
                    album,
                    bitrate: Some(bitrate),
                    ..File::default()
                },
            );
        }

        let albums = worst_by_bitrate(&conn, &TrackQuery::default(), 10).unwrap();
        assert_eq!(
            albums
                .iter()
                .map(|album| (album.album.as_str(), album.tracks, album.mean_bitrate))
                .collect::<Vec<_>>(),
            [("Harbour", 1, 128), ("Tide", 2, 288)]
        );
    }

    #[test]
    fn the_genre_breakdown_drills_one_primary_parent_at_a_time() {
        let (_dir, conn) = open();
        for genre in [
            Some("Black Metal"),
            Some("Atmospheric Black Metal"),
            Some("Atmospheric Black Metal"),
            Some("Trve Kvlt Raw Black Metal"),
            None,
            Some(""),
        ] {
            add_file(
                &conn,
                File {
                    genre,
                    ..File::default()
                },
            );
        }
        let query = TrackQuery::default();

        let roots = genre_breakdown(&conn, &query, None).unwrap();
        assert_eq!((roots.untagged, roots.own), (2, 0));
        assert_eq!(roots.slices.len(), 1, "one root: {:?}", roots.slices);
        assert_eq!(roots.slices[0].tracks, 4);
        assert!(roots.slices[0].has_children);

        let black = genre_breakdown(&conn, &query, Some("Black Metal")).unwrap();
        assert_eq!((black.untagged, black.own), (0, 1));
        assert_eq!(
            black.slices,
            [
                GenreSlice {
                    label: "atmospheric black metal".to_owned(),
                    tracks: 2,
                    parent_source: genres::ParentSource::Wikidata,
                    has_children: false,
                },
                GenreSlice {
                    label: "raw black metal".to_owned(),
                    tracks: 1,
                    parent_source: genres::ParentSource::Wikidata,
                    has_children: true,
                },
            ]
        );

        let raw = genre_breakdown(&conn, &query, Some("raw black metal")).unwrap();
        assert_eq!(raw.slices.len(), 1);
        assert_eq!(raw.slices[0].parent_source, genres::ParentSource::Derived);
    }

    /// Library aggregates go through `scope`, so a view narrows them exactly
    /// as it narrows the songs table.
    #[test]
    fn library_aggregates_follow_the_view_they_are_scoped_to() {
        let (_dir, conn) = open();
        add_file(
            &conn,
            File {
                artist: Some("Blue Room"),
                ..File::default()
            },
        );
        add_file(
            &conn,
            File {
                artist: Some("Nobody"),
                title: Some("Nothing"),
                ..File::default()
            },
        );
        let query = TrackQuery {
            browse: Some(BrowseFilter {
                kind: BrowseKind::Artists,
                key: Some("Blue Room".to_owned()),
                secondary: None,
            }),
            ..TrackQuery::default()
        };

        assert_eq!(library_totals(&conn, &query).unwrap().tracks, 1);
        assert_eq!(
            tag_health(&conn, &query).unwrap(),
            TagHealth {
                tracks: 1,
                title: 1,
                album: 1,
                album_artist: 1,
                genre: 1,
                year: 1,
                track_no: 1,
                cover: 1,
                ..TagHealth::default()
            }
        );
    }

    #[test]
    fn additions_are_bucketed_by_local_day() {
        let (_dir, conn) = open();
        for wall_clock in [
            "2024-03-05 23:30:00",
            "2024-03-20 08:00:00",
            "2024-04-01 00:10:00",
        ] {
            let added_at = local(&conn, wall_clock);
            add_file(
                &conn,
                File {
                    added_at,
                    ..File::default()
                },
            );
        }

        assert_eq!(
            series(&added_over_time(&conn, &TrackQuery::default(), TimeBucket::Month).unwrap()),
            [("2024-03-01", 2), ("2024-04-01", 1)]
        );
    }
}
