//! The vocabulary a library already uses, and lookups against it.
//!
//! Typing "Godspeed You! Black Emperor" correctly by hand for the fourth time
//! is how a library acquires three spellings of one band. These are the values
//! already present elsewhere, so the editor can offer them.
//!
//! # Why a rebuild rather than incremental bookkeeping
//!
//! The plan called for `uses` to be adjusted in step with every write - a scan
//! ingest, a tag edit, an undo, a removal - and noted that this is where it
//! would break. It was right, so this does not do it.
//!
//! Instead the whole table is recomputed from `tracks` whenever the tracks
//! could have changed. That is five grouped aggregates over a table that is
//! already indexed on most of these columns, and it is correct by construction:
//! there is no drift to detect, no repair path to write, and no ordering
//! dependency between a file write and a count. The cost is bounded by the
//! library, not by the edit - a 50k-row rebuild is asserted against a budget in
//! `tests/perf.rs` - and it runs after a scan or an edit, neither of which is
//! something a person does while trying to type.
//!
//! The alternative worth naming is SQLite triggers on `tracks`, which would be
//! automatically correct in the same way. They lose on cost: thirty statements
//! of migration SQL to maintain, and a per-row price paid during the one
//! operation that touches 50k rows at once.

use rusqlite::Connection;

use crate::error::AppResult;
use crate::model::TagValueField;
use crate::smart::{like_escape, LIKE_ESCAPE};

/// How many suggestions a lookup returns.
///
/// Eight is what fits under a field without covering the rest of the dialog,
/// and a list longer than that is one you read rather than glance at.
pub const SUGGESTION_LIMIT: u32 = 8;

impl TagValueField {
    /// The `tracks` column this vocabulary is drawn from.
    ///
    /// Every arm is a literal, because the result is interpolated into SQL -
    /// the same whitelist discipline `FilterField::as_sql` follows.
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::Artist => "artist",
            Self::AlbumArtist => "album_artist",
            Self::Album => "album",
            Self::Genre => "genre",
            Self::Year => "year",
        }
    }

    /// How the field is spelled in `tag_values.field`.
    ///
    /// The same string as the column, but a separate method so the storage
    /// format is not silently tied to a column rename.
    pub fn key(self) -> &'static str {
        self.as_sql()
    }

    pub const ALL: &'static [Self] = &[
        Self::Artist,
        Self::AlbumArtist,
        Self::Album,
        Self::Genre,
        Self::Year,
    ];
}

/// Recomputes the whole vocabulary from `tracks`.
///
/// Called after a scan and after any edit that writes tags. Blank strings are
/// excluded as well as nulls: a file with an empty artist frame has no artist,
/// and offering "" as a suggestion is offering nothing.
///
/// Missing files still count. Their rows are intact and their tags are still
/// part of what the library says, so an unplugged drive should not quietly
/// change which spelling of a band ranks first.
pub fn rebuild(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM tag_values", [])?;
    for field in TagValueField::ALL {
        let column = field.as_sql();
        // `trim() <> ''` rather than `<> ''`: a tag of three spaces is as empty
        // as one of none, and it would otherwise sort to the top of every list.
        conn.execute(
            &format!(
                "INSERT INTO tag_values (field, value, uses)
                 SELECT ?1, CAST({column} AS TEXT), count(*)
                 FROM tracks
                 WHERE {column} IS NOT NULL AND trim(CAST({column} AS TEXT)) <> ''
                 GROUP BY CAST({column} AS TEXT)"
            ),
            [field.key()],
        )?;
    }
    Ok(())
}

/// The suggestions for what someone has typed so far.
///
/// An empty `query` returns the most-used values, which is what an `is` filter
/// wants when the field is still blank. A non-empty one matches anywhere in the
/// value, but ranks prefix matches first: typing "black" should offer "Black
/// Sabbath" above "Frank Black", while still offering both.
pub fn suggest(
    conn: &Connection,
    field: TagValueField,
    query: &str,
    limit: u32,
) -> AppResult<Vec<String>> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        let mut stmt = conn.prepare(
            "SELECT value FROM tag_values WHERE field = ?1
             ORDER BY uses DESC, value COLLATE NOCASE LIMIT ?2",
        )?;
        let rows = stmt.query_map(rusqlite::params![field.key(), limit], |row| row.get(0))?;
        return Ok(rows.collect::<Result<Vec<String>, _>>()?);
    }

    // Escaped, because a band name is allowed to contain `%` and `_` and must
    // not turn into a wildcard - the same treatment a `contains` filter gets.
    let escaped = like_escape(trimmed);
    let mut stmt = conn.prepare(&format!(
        "SELECT value FROM tag_values
         WHERE field = ?1 AND value LIKE ?2 ESCAPE '{LIKE_ESCAPE}'
         ORDER BY (value LIKE ?3 ESCAPE '{LIKE_ESCAPE}') DESC, uses DESC, value COLLATE NOCASE
         LIMIT ?4"
    ))?;
    let rows = stmt.query_map(
        rusqlite::params![
            field.key(),
            format!("%{escaped}%"),
            format!("{escaped}%"),
            limit
        ],
        |row| row.get(0),
    )?;
    Ok(rows.collect::<Result<Vec<String>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("in-memory database");
        migrate(&mut conn).expect("migrations apply");
        conn
    }

    fn add(conn: &Connection, artist: &str, album: &str, genre: &str, year: Option<i64>) {
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, artist, album, album_artist, genre, year, added_at)
             VALUES (?1, 0, 0, ?2, ?3, ?2, ?4, ?5, 0)",
            rusqlite::params![
                format!("/m/{}.mp3", rand_path()),
                artist,
                album,
                genre,
                year
            ],
        )
        .expect("insert track");
    }

    /// Paths are UNIQUE and these tests do not care what they are.
    fn rand_path() -> String {
        use std::sync::atomic::{AtomicU32, Ordering};
        static NEXT: AtomicU32 = AtomicU32::new(0);
        NEXT.fetch_add(1, Ordering::Relaxed).to_string()
    }

    #[test]
    fn counts_how_many_tracks_carry_each_value() {
        let conn = db();
        add(&conn, "Grizzly Bear", "Veckatimest", "Rock", Some(2009));
        add(&conn, "Grizzly Bear", "Shields", "Rock", Some(2012));
        add(&conn, "Beach House", "Teen Dream", "Dream Pop", Some(2010));
        rebuild(&conn).expect("rebuild");

        let uses: i64 = conn
            .query_row(
                "SELECT uses FROM tag_values WHERE field = 'artist' AND value = 'Grizzly Bear'",
                [],
                |row| row.get(0),
            )
            .expect("the value is there");
        assert_eq!(uses, 2);
    }

    #[test]
    fn ranks_the_spelling_in_wide_use_above_the_typo() {
        let conn = db();
        for _ in 0..5 {
            add(
                &conn,
                "Godspeed You! Black Emperor",
                "Lift",
                "Post-Rock",
                None,
            );
        }
        add(
            &conn,
            "Godspeed You Black Emperor",
            "Lift",
            "Post-Rock",
            None,
        );
        rebuild(&conn).expect("rebuild");

        let found = suggest(&conn, TagValueField::Artist, "godspeed", 8).expect("suggest");
        assert_eq!(found[0], "Godspeed You! Black Emperor");
        assert_eq!(found.len(), 2);
    }

    #[test]
    fn a_value_nothing_carries_any_more_stops_being_offered() {
        let conn = db();
        add(&conn, "Beach Huose", "Teen Dream", "Dream Pop", None);
        rebuild(&conn).expect("rebuild");
        assert_eq!(
            suggest(&conn, TagValueField::Artist, "beach", 8).expect("suggest"),
            vec!["Beach Huose".to_owned()]
        );

        // The typo corrected, the way the tag writer would leave it.
        conn.execute("UPDATE tracks SET artist = 'Beach House'", [])
            .expect("fix the typo");
        rebuild(&conn).expect("rebuild");

        assert_eq!(
            suggest(&conn, TagValueField::Artist, "beach", 8).expect("suggest"),
            vec!["Beach House".to_owned()]
        );
    }

    #[test]
    fn prefix_matches_rank_above_interior_ones() {
        let conn = db();
        // The interior match is on more tracks, so only the prefix rule can put
        // the other first.
        for _ in 0..3 {
            add(&conn, "Frank Black", "Teenager", "Rock", None);
        }
        add(&conn, "Black Sabbath", "Paranoid", "Metal", None);
        rebuild(&conn).expect("rebuild");

        let found = suggest(&conn, TagValueField::Artist, "black", 8).expect("suggest");
        assert_eq!(found, vec!["Black Sabbath", "Frank Black"]);
    }

    #[test]
    fn matches_regardless_of_case() {
        let conn = db();
        add(&conn, "Boards of Canada", "Geogaddi", "IDM", None);
        rebuild(&conn).expect("rebuild");

        assert_eq!(
            suggest(&conn, TagValueField::Artist, "BOARDS", 8).expect("suggest"),
            vec!["Boards of Canada".to_owned()]
        );
    }

    #[test]
    fn a_wildcard_in_the_query_matches_itself_and_not_everything() {
        let conn = db();
        add(&conn, "100%", "Whatever", "Rock", None);
        add(&conn, "Radiohead", "Kid A", "Rock", None);
        rebuild(&conn).expect("rebuild");

        // Unescaped, `%` would match every artist in the library.
        assert_eq!(
            suggest(&conn, TagValueField::Artist, "%", 8).expect("suggest"),
            vec!["100%".to_owned()]
        );
        // `_` is the other wildcard, and the same rule applies.
        assert_eq!(
            suggest(&conn, TagValueField::Artist, "_", 8).expect("suggest"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn an_empty_query_offers_the_most_used_values() {
        let conn = db();
        for _ in 0..3 {
            add(&conn, "Mogwai", "Rock Action", "Post-Rock", None);
        }
        add(&conn, "Slint", "Spiderland", "Post-Rock", None);
        rebuild(&conn).expect("rebuild");

        assert_eq!(
            suggest(&conn, TagValueField::Artist, "", 8).expect("suggest"),
            vec!["Mogwai".to_owned(), "Slint".to_owned()]
        );
    }

    #[test]
    fn blank_and_absent_tags_are_not_a_vocabulary() {
        let conn = db();
        add(&conn, "", "Album", "", None);
        add(&conn, "   ", "Album", "Rock", None);
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, added_at) VALUES ('/m/bare.mp3', 0, 0, 0)",
            [],
        )
        .expect("a file with no tags at all");
        rebuild(&conn).expect("rebuild");

        assert_eq!(
            suggest(&conn, TagValueField::Artist, "", 8).expect("suggest"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn years_are_a_vocabulary_too_even_though_they_are_numbers() {
        let conn = db();
        add(&conn, "Grizzly Bear", "Shields", "Rock", Some(2012));
        add(&conn, "Beach House", "Bloom", "Dream Pop", Some(2012));
        rebuild(&conn).expect("rebuild");

        assert_eq!(
            suggest(&conn, TagValueField::Year, "201", 8).expect("suggest"),
            vec!["2012".to_owned()]
        );
    }

    #[test]
    fn an_existing_library_has_a_vocabulary_the_moment_it_migrates() {
        // The case autocompletion is *for* is the library that already has a
        // vocabulary, and that library was scanned before this table existed.
        // Migration 5 therefore backfills; leaving it to the next scan would
        // mean the feature quietly does nothing until someone happens to
        // rescan, which is indistinguishable from it being broken.
        let mut conn = Connection::open_in_memory().expect("in-memory database");
        // Stop one migration short of the vocabulary, so the tracks below are
        // written by a build that has never heard of `tag_values`.
        for (index, sql) in crate::db::schema::MIGRATIONS.iter().enumerate().take(4) {
            conn.execute_batch(sql).expect("migration applies");
            conn.pragma_update(None, "user_version", (index + 1) as i64)
                .expect("version recorded");
        }
        add(&conn, "Mogwai", "Rock Action", "Post-Rock", Some(2001));
        add(&conn, "Mogwai", "Happy Songs", "Post-Rock", Some(2003));

        migrate(&mut conn).expect("the rest of the migrations apply");

        assert_eq!(
            suggest(&conn, TagValueField::Artist, "mog", 8).expect("suggest"),
            vec!["Mogwai".to_owned()]
        );
        let uses: i64 = conn
            .query_row(
                "SELECT uses FROM tag_values WHERE field = 'artist' AND value = 'Mogwai'",
                [],
                |row| row.get(0),
            )
            .expect("the value is there");
        assert_eq!(uses, 2, "the backfill has to count, not just list");
    }

    #[test]
    fn a_rebuild_replaces_rather_than_accumulates() {
        let conn = db();
        add(&conn, "Mogwai", "Rock Action", "Post-Rock", None);
        rebuild(&conn).expect("rebuild");
        rebuild(&conn).expect("rebuild again");

        let uses: i64 = conn
            .query_row(
                "SELECT uses FROM tag_values WHERE field = 'artist' AND value = 'Mogwai'",
                [],
                |row| row.get(0),
            )
            .expect("the value is there");
        assert_eq!(uses, 1, "a second rebuild must not double the counts");
    }

    #[test]
    fn the_limit_is_honoured() {
        let conn = db();
        for index in 0..20 {
            add(&conn, &format!("Band {index}"), "Album", "Rock", None);
        }
        rebuild(&conn).expect("rebuild");

        assert_eq!(
            suggest(&conn, TagValueField::Artist, "band", 8)
                .expect("suggest")
                .len(),
            8
        );
    }
}
