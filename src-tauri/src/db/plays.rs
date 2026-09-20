//! The play log: one row per play, and the link from a play back to a file.
//!
//! # Why the link is rebuilt rather than maintained
//!
//! A play is a historical fact - the artist and title as they were when it
//! happened - so the only thing about it that can go stale is `track_id`. That
//! makes it derived data, and this module treats it the way
//! [`crate::db::tag_values`] treats the vocabulary: recompute the whole thing
//! whenever the tracks could have changed, rather than adjusting it in step
//! with every write. There is no drift to detect, no repair path to write, and
//! no ordering dependency between a file write and a link.
//!
//! # Why the key is not a column on `tracks`
//!
//! Normalization is Rust-side, because SQLite's `lower()` and `COLLATE NOCASE`
//! are ASCII-only and would leave Motörhead and Sigur Rós unfolded. So a
//! `tracks.match_key` column would have to be filled at every site that writes
//! a track row - the ordering dependency above - or recomputed over the whole
//! library on every rebuild, which costs more than the thing it was meant to
//! make cheap. [`resolve`] materializes it in a temporary table instead.

use rusqlite::{Connection, OptionalExtension};

use crate::error::AppResult;

/// Separates artist from title inside a key.
///
/// A character no tag carries, so `("ab", "c")` and `("a", "bc")` cannot
/// collide into one key.
const SEPARATOR: char = '\u{1f}';

/// The identity two spellings of one song share, or empty for a play nothing
/// can be matched to.
///
/// **Deliberately conservative**: lowercase, collapsed whitespace, and a
/// trailing `(feat. …)` or `(with …)` dropped. Nothing else. Folding `(Live)`
/// into the studio cut would destroy a distinction the MBIDs exist to
/// preserve, and a key that matched too much is worse than one that matches
/// nothing - it attributes plays to a song the user never heard.
///
/// **Either side missing empties the whole key.** A key built from nothing
/// would match every untagged file in the library, so a play with no artist is
/// kept and stays unmatched rather than being attached to whatever happens to
/// be as blank as it is.
pub fn match_key(artist: &str, title: &str) -> String {
    let artist = normalize(artist);
    let title = normalize(title);
    if artist.is_empty() || title.is_empty() {
        return String::new();
    }
    format!("{artist}{SEPARATOR}{title}")
}

/// The identity two spellings of one album share, or empty for a play with no
/// album to group.
///
/// **Conservative in [`match_key`]'s way, and wider than it in exactly the
/// ways the log forces.** A play keeps the album as it was scrobbled, and a
/// streaming service renames a release between one scrobble and the next:
/// `Addicts: Black Meddle Pt. 2`, `… Pt. II`, `…, Pt. II` and `… Part II` are
/// one record heard 1,112 times. Over a real log the causes are a
/// parenthesised edition marker, punctuation, roman against arabic parts,
/// diacritics and non-ASCII case, in that order of size - and this folds those
/// five and stops.
///
/// **`version` and `special` are deliberately not in the vocabulary.**
/// Stripping a bare `(… Version)` would fold `(Live Version)` and
/// `(Acoustic Version)` into the studio cut, which is the failure `match_key`
/// refuses for the same reason. Keeping them out costs 11 groups and 152
/// plays, all of which [`EDITIONS`] catches by another route.
///
/// **An empty album empties the whole key**, for the reason an empty side
/// empties `match_key`: a key built from the artist alone would gather every
/// untitled play under one heading. The artist may be blank - `top` draws an
/// album whether or not one is tagged.
pub fn album_key(artist: &str, album: &str) -> String {
    let album = fold_album(album);
    if album.is_empty() {
        return String::new();
    }
    format!("{}{SEPARATOR}{album}", squeeze(&decompose(artist)))
}

/// The words that mark a parenthesised run, or a ` - ` suffix, as an edition
/// of the album rather than part of its title.
///
/// Matched as substrings, so `remaster` covers `Remastered` and
/// `Remastering`.
const EDITIONS: &[&str] = &[
    "deluxe",
    "remaster",
    "bonus",
    "expanded",
    "anniversary",
    "edition",
    "explicit",
    "reissue",
    "premium",
];

/// The two suffixes that name a format rather than an edition, matched whole.
const FORMATS: &[&str] = &["ep", "single"];

/// The album side of [`album_key`].
fn fold_album(album: &str) -> String {
    let mut folded = decompose(album);
    // Alternating rather than one pass each: `White Pony (Deluxe) - Remastered
    // 2020` carries both, and stripping either uncovers the other. Both
    // strippers answer with a prefix of what they were given, which is what
    // makes truncating to its length the same thing as taking it.
    loop {
        let shorter = without_suffix(without_edition(&folded)).len();
        if shorter == folded.len() {
            break;
        }
        folded.truncate(shorter);
    }
    parts_in_arabic(&squeeze(&folded))
}

/// `value` lowercased, compatibility-decomposed, and stripped of the combining
/// marks that decomposition exposed.
///
/// NFKD rather than NFD because `…` is one codepoint that only compatibility
/// decomposition turns into `...`, which is the whole of the Marathonmann
/// group - three spellings and 184 plays.
fn decompose(value: &str) -> String {
    use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

    value
        .to_lowercase()
        .nfkd()
        .filter(|character| !is_combining_mark(*character))
        .collect()
}

/// `value` with everything that is not a letter or a digit turned into a
/// space, and runs of space collapsed.
///
/// The 46 punctuation-only groups are `Addicts: Black Meddle` against
/// `Addicts Black Meddle` and `d'un` against `d un`, so the fold cannot keep
/// any of it.
fn squeeze(value: &str) -> String {
    value
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// `value` without a trailing parenthesised or bracketed edition marker.
///
/// Only at the end: `(Deluxe Edition)` mid-title is part of the title, and a
/// run anywhere would be a second thing to be wrong about.
fn without_edition(value: &str) -> &str {
    let trimmed = value.trim_end();
    let opener = if trimmed.ends_with(')') {
        '('
    } else if trimmed.ends_with(']') {
        '['
    } else {
        return value;
    };
    let Some(open) = trimmed.rfind(opener) else {
        return value;
    };
    let inside = &trimmed[open + 1..trimmed.len() - 1];
    if EDITIONS.iter().any(|word| inside.contains(word)) {
        trimmed[..open].trim_end()
    } else {
        value
    }
}

/// `value` without a trailing ` - ` run naming a format or an edition.
///
/// A format is matched whole and an edition by its vocabulary: `- EP` is the
/// release, and `- Remastered 2020` and `- Deluxe Edition` are one.
fn without_suffix(value: &str) -> &str {
    let trimmed = value.trim_end();
    let Some(dash) = trimmed.rfind(" - ") else {
        return value;
    };
    let suffix = trimmed[dash + 3..].trim();
    let named = FORMATS.contains(&suffix) || EDITIONS.iter().any(|word| suffix.contains(word));
    if named {
        trimmed[..dash].trim_end()
    } else {
        value
    }
}

/// `value` with every `pt`/`part` marker spelled `pt` and its numeral in
/// arabic.
///
/// Both halves are needed for one group: the four Nachtmystium spellings are
/// `Pt. 2`, `Pt. II`, `, Pt. II` and `Part II`, so folding the numeral without
/// the marker still leaves two groups. Runs on the squeezed string, where
/// `Pt.` and `Pt` are already one word.
fn parts_in_arabic(value: &str) -> String {
    let mut words: Vec<String> = value.split(' ').map(str::to_owned).collect();
    for index in 0..words.len().saturating_sub(1) {
        if words[index] != "pt" && words[index] != "part" {
            continue;
        }
        let Some(number) = roman(&words[index + 1]) else {
            continue;
        };
        words[index] = "pt".to_owned();
        words[index + 1] = number.to_string();
    }
    words.join(" ")
}

/// `word` as a number, for a roman numeral or an arabic one.
///
/// **Canonical spellings only**: the value is rendered back and compared, so
/// the greedy pass below does not let `iiii` or `viv` through as 4. What that
/// does not catch is a word that is also a canonical numeral - `mi` is 1001 -
/// and what bounds it is the position: only the word after `pt` or `part` is
/// read as one.
fn roman(word: &str) -> Option<u32> {
    if let Ok(number) = word.parse::<u32>() {
        return Some(number);
    }

    const NUMERALS: &[(u32, &str)] = &[
        (1000, "m"),
        (900, "cm"),
        (500, "d"),
        (400, "cd"),
        (100, "c"),
        (90, "xc"),
        (50, "l"),
        (40, "xl"),
        (10, "x"),
        (9, "ix"),
        (5, "v"),
        (4, "iv"),
        (1, "i"),
    ];

    let mut value = 0;
    let mut rest = word;
    for (number, numeral) in NUMERALS {
        while let Some(shorter) = rest.strip_prefix(numeral) {
            value += number;
            rest = shorter;
        }
    }
    if !rest.is_empty() || value == 0 {
        return None;
    }

    // The greedy pass above accepts `iiii` and `viv` as well as `iv`, and both
    // render back as something else.
    let mut canonical = String::new();
    let mut left = value;
    for (number, numeral) in NUMERALS {
        while left >= *number {
            canonical.push_str(numeral);
            left -= number;
        }
    }
    (canonical == word).then_some(value)
}

/// One side of a key.
fn normalize(value: &str) -> String {
    let lowered = value.to_lowercase();
    let trimmed = without_featuring(lowered.trim());
    trimmed.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `value` without a trailing parenthesised credit.
///
/// The one suffix worth dropping: the same song is tagged `Song`,
/// `Song (feat. Guest)` and `Song (with Guest)` across a library, and they are
/// one song. Only at the end, and only these openers - `(Live)`,
/// `(Remastered)` and `(Radio Edit)` name different recordings and stay.
fn without_featuring(value: &str) -> &str {
    const OPENERS: &[&str] = &["feat.", "feat ", "featuring ", "ft.", "ft ", "with "];

    let Some(rest) = value.strip_suffix(')') else {
        return value;
    };
    let Some(open) = rest.rfind('(') else {
        return value;
    };
    let inside = &rest[open + 1..];
    if OPENERS.iter().any(|opener| inside.starts_with(opener)) {
        rest[..open].trim_end()
    } else {
        value
    }
}

/// Writes down that a track was played, snapshotting its tags as they are now.
///
/// **The log does not inherit the scrobbler's rules.** `lastfm::rules` refuses
/// a track with no artist and a track shorter than thirty seconds; those are
/// last.fm's conditions for accepting a scrobble, not this app's for
/// remembering a play.
///
/// `OR IGNORE` rather than a plain insert, and that is about the transaction
/// this shares with [`crate::db::playback::mark_played`] rather than about
/// duplicates: a constraint violation here would roll back the `play_count`
/// increment with it, trading a missing log row for a wrong play count.
///
/// The initial `track_id` is the track that played, which is what [`resolve`]
/// will compute for it unless the library holds the same song twice - the
/// album copy and the compilation copy - in which case the next rebuild moves
/// the play to whichever of them that function picks. `resolve` is
/// authoritative; this is what keeps the row linked until one runs.
pub fn record(conn: &Connection, track_id: i64, started_at: i64) -> AppResult<()> {
    let snapshot = conn
        .query_row(
            "SELECT artist, title, album, duration_ms FROM tracks WHERE id = ?1",
            [track_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()?;
    // A track removed between the play threshold and this write. Nothing to
    // record, and nothing worth failing playback over.
    let Some((artist, title, album, duration_ms)) = snapshot else {
        return Ok(());
    };

    let artist = artist.unwrap_or_default().trim().to_owned();
    let title = title.unwrap_or_default().trim().to_owned();
    let key = match_key(&artist, &title);
    let link = (!key.is_empty()).then_some(track_id);

    conn.execute(
        "INSERT OR IGNORE INTO plays
            (started_at, source, artist, title, album, duration_ms, match_key, track_id)
         VALUES (?1, 'local', ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![started_at, artist, title, album, duration_ms, key, link],
    )?;

    // A spelling [`regroup`] has not seen yet, so that the play reads under a
    // heading now rather than after the next import. `OR IGNORE`, so a pinned
    // row is never overwritten by a play arriving under it.
    if let Some(album) = album.as_deref().filter(|album| !album.trim().is_empty()) {
        let key = album_key(&artist, album);
        if !key.is_empty() {
            conn.execute(
                "INSERT OR IGNORE INTO album_groups (artist, album, key, heading)
                 VALUES (?1, ?2, ?3, coalesce(
                     (SELECT heading FROM album_groups WHERE key = ?3
                       GROUP BY heading ORDER BY count(*) DESC, heading LIMIT 1),
                     ?2))",
                rusqlite::params![artist, album, key],
            )?;
        }
    }
    Ok(())
}

/// A MusicBrainz id as `plays` stores it, or none for a blank.
///
/// Recorded, not matched on: 78 measured last.fm's own recording ids against
/// the ones in the files and found 14% agreement and no link the `match_key`
/// had not already made. Lowercased so the column reads the same whoever
/// wrote it.
pub fn mbid(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_ascii_lowercase())
}

/// Recomputes `plays.track_id` for the whole log, returning how many links
/// moved.
///
/// Runs wherever [`crate::db::tag_values::rebuild`] runs - the end of a scan,
/// a tag write, and both removals - for the reason that module gives at
/// length. The count is what the tests assert idempotence with; no caller
/// needs it.
pub fn resolve(conn: &Connection) -> AppResult<u32> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS temp.play_keys;
         CREATE TEMP TABLE play_keys (
             key      TEXT PRIMARY KEY,
             track_id INTEGER NOT NULL
         ) WITHOUT ROWID;",
    )?;

    {
        // **Which track wins a key is fixed rather than incidental.** The same
        // song on its album and on a compilation is two rows and one key, and
        // a library has hundreds of those. Present beats unplugged and the
        // older id beats the newer, which is migration 12's tiebreak for the
        // same reason it was chosen there: without one the winner follows scan
        // order, this function stops being idempotent, and the guarded UPDATE
        // below rewrites the whole table on every run.
        let mut tracks = conn.prepare(
            "SELECT id, artist, title FROM tracks ORDER BY missing_since IS NOT NULL, id",
        )?;
        let mut insert =
            conn.prepare("INSERT OR IGNORE INTO temp.play_keys (key, track_id) VALUES (?1, ?2)")?;

        let mut rows = tracks.query([])?;
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let artist: Option<String> = row.get(1)?;
            let title: Option<String> = row.get(2)?;
            let key = match_key(
                artist.as_deref().unwrap_or_default(),
                title.as_deref().unwrap_or_default(),
            );
            if key.is_empty() {
                continue;
            }
            insert.execute(rusqlite::params![key, id])?;
        }
    }

    // **The guard is what makes the full scan affordable.** After a three-track
    // tag edit the statement still reads every play, but it writes only the
    // handful whose link actually moved, instead of rewriting a quarter of a
    // million rows to the values they already held.
    //
    // `IS NOT` rather than `<>` because most of those values are NULL on both
    // sides, and `<>` is NULL there rather than false.
    let moved = conn.execute(
        "UPDATE plays
            SET track_id = (SELECT k.track_id FROM temp.play_keys k WHERE k.key = plays.match_key)
          WHERE match_key <> ''
            AND track_id IS NOT
                (SELECT k.track_id FROM temp.play_keys k WHERE k.key = plays.match_key)",
        [],
    )?;

    conn.execute_batch("DROP TABLE temp.play_keys;")?;
    Ok(moved as u32)
}

/// Recomputes `album_groups` for the whole log, returning how many rows moved.
///
/// Follows [`resolve`]'s shape - recompute rather than maintain - for that
/// function's reason, and runs where the log changes wholesale: the end of an
/// import, and once after [`FOLD_VERSION`] moves. 13,708 distinct spellings
/// over a quarter of a million plays, so a full pass is cheap; the mid-session
/// case is one row, written by [`record`].
///
/// **Headings are re-chosen only here.** A variant overtaking the leader
/// between two passes would rename a row under the cursor, so nothing outside
/// this function picks one.
///
/// # What a pinned row does
///
/// It keeps its own heading, always. What it does to the rest of its key
/// depends on which of the dialog's three writes made it:
///
/// - Pinned with a heading that is not its own spelling, it is a retitle or a
///   merge, and the unpinned rows of its key follow it. Otherwise a retitled
///   group would revert the moment a new spelling arrived.
/// - Pinned with its own spelling, it is a separation, and the rest of the key
///   must not follow it out - they name themselves after their own biggest
///   instead.
pub fn regroup(conn: &Connection) -> AppResult<u32> {
    use std::collections::HashMap;

    struct Member {
        artist: String,
        album: String,
        plays: u32,
        pinned: bool,
        heading: String,
    }

    let mut stored: HashMap<(String, String), (String, String, bool)> = HashMap::new();
    {
        let mut statement =
            conn.prepare("SELECT artist, album, key, heading, pinned FROM album_groups")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            stored.insert(
                (row.get(0)?, row.get(1)?),
                (row.get(2)?, row.get(3)?, row.get::<_, i64>(4)? != 0),
            );
        }
    }

    // Verbatim, under the binary collation the primary key uses: the pass
    // enumerates the spellings as they are stored, so the join back onto
    // `plays` is an exact match on every row.
    let mut members: HashMap<String, Vec<Member>> = HashMap::new();
    {
        let mut statement = conn.prepare(
            "SELECT artist, album, count(*) FROM plays
              WHERE album IS NOT NULL AND album <> '' GROUP BY artist, album",
        )?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let artist: String = row.get(0)?;
            let album: String = row.get(1)?;
            let key = album_key(&artist, &album);
            if key.is_empty() {
                continue;
            }
            let (pinned, heading) = match stored.get(&(artist.clone(), album.clone())) {
                Some((_, heading, true)) => (true, heading.clone()),
                _ => (false, album.clone()),
            };
            members.entry(key).or_default().push(Member {
                artist,
                album,
                plays: row.get::<_, i64>(2)? as u32,
                pinned,
                heading,
            });
        }
    }

    let mut wanted: HashMap<(String, String), (String, String)> = HashMap::new();
    for (key, mut group) in members {
        // Ties are broken by spelling so the answer does not follow row order,
        // which is what keeps a second pass over an unchanged log free.
        group.sort_by(|a, b| b.plays.cmp(&a.plays).then_with(|| a.album.cmp(&b.album)));
        let claimed = group
            .iter()
            .find(|member| member.pinned && member.heading != member.album)
            .map(|member| member.heading.clone());
        let fallback = group
            .iter()
            .find(|member| !member.pinned)
            .map(|member| member.album.clone());
        for member in group {
            let heading = if member.pinned {
                member.heading
            } else {
                claimed
                    .clone()
                    .or_else(|| fallback.clone())
                    .unwrap_or_else(|| member.album.clone())
            };
            wanted.insert((member.artist, member.album), (key.clone(), heading));
        }
    }

    let mut moved = 0;
    let mut upsert = conn.prepare(
        "INSERT INTO album_groups (artist, album, key, heading) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (artist, album) DO UPDATE SET key = excluded.key, heading = excluded.heading",
    )?;
    for ((artist, album), (key, heading)) in &wanted {
        if stored
            .get(&(artist.clone(), album.clone()))
            .is_some_and(|(had_key, had_heading, _)| had_key == key && had_heading == heading)
        {
            continue;
        }
        upsert.execute(rusqlite::params![artist, album, key, heading])?;
        moved += 1;
    }

    // **A pinned row outlives the plays it was written for.** The correction
    // cost the user a dialog and costs the table one short row; an import run
    // fresh empties `plays` before it refills it, and dropping corrections
    // there would be silent.
    let mut forget = conn.prepare("DELETE FROM album_groups WHERE artist = ?1 AND album = ?2")?;
    for ((artist, album), (_, _, pinned)) in &stored {
        if *pinned || wanted.contains_key(&(artist.clone(), album.clone())) {
            continue;
        }
        forget.execute([artist, album])?;
        moved += 1;
    }

    Ok(moved)
}

/// Which [`album_key`] `album_groups` is expected to have been built with.
///
/// **Bump this whenever the fold changes what it folds together.** An edition
/// word added to `EDITIONS`, a suffix added to `FORMATS`, a new cause
/// altogether - each of them leaves every existing library grouped the way
/// the old vocabulary grouped it, and nothing else asks for a pass.
const FOLD_VERSION: &str = "1";

/// Runs [`regroup`] if this library's grouping predates [`FOLD_VERSION`],
/// answering whether it did.
///
/// A marker in the shape of `settings::COVERS_NORMALIZED` rather than a
/// migration, for that flag's reason in miniature: the pass reads every play
/// and writes a row per spelling, and the transaction that runs before the
/// window is shown is not where that belongs.
pub fn regroup_if_stale(conn: &Connection) -> AppResult<bool> {
    use crate::db::settings;

    if settings::get(conn, settings::ALBUM_FOLD)?.as_deref() == Some(FOLD_VERSION) {
        return Ok(false);
    }
    regroup(conn)?;
    settings::set(conn, settings::ALBUM_FOLD, FOLD_VERSION)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{playback, Db};

    fn open() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    fn add_track(conn: &Connection, id: i64, artist: Option<&str>, title: Option<&str>) {
        conn.execute(
            "INSERT INTO tracks (id, path, mtime, size, duration_ms, artist, title, added_at)
             VALUES (?1, ?2, 0, 0, 240000, ?3, ?4, 0)",
            rusqlite::params![id, format!("C:\\music\\{id}.mp3"), artist, title],
        )
        .unwrap();
    }

    /// `count` imported plays of one album, each a second apart from the last
    /// so the identity index takes them all.
    fn heard(conn: &Connection, artist: &str, album: &str, count: i64) {
        let next: i64 = conn
            .query_row(
                "SELECT coalesce(max(started_at), 0) FROM plays",
                [],
                |row| row.get(0),
            )
            .unwrap();
        for offset in 1..=count {
            conn.execute(
                "INSERT INTO plays (started_at, source, artist, title, album, match_key)
                 VALUES (?1, 'lastfm', ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    next + offset,
                    artist,
                    format!("Track {offset}"),
                    album,
                    match_key(artist, &format!("Track {offset}")),
                ],
            )
            .unwrap();
        }
    }

    fn heading(conn: &Connection, artist: &str, album: &str) -> Option<String> {
        conn.query_row(
            "SELECT heading FROM album_groups WHERE artist = ?1 AND album = ?2",
            [artist, album],
            |row| row.get(0),
        )
        .optional()
        .unwrap()
    }

    fn pin(conn: &Connection, artist: &str, album: &str, heading: &str) {
        conn.execute(
            "INSERT INTO album_groups (artist, album, key, heading, pinned)
             VALUES (?1, ?2, ?3, ?4, 1)
             ON CONFLICT (artist, album) DO UPDATE SET heading = excluded.heading, pinned = 1",
            rusqlite::params![artist, album, album_key(artist, album), heading],
        )
        .unwrap();
    }

    const ADDICTS: [(&str, i64); 4] = [
        ("Addicts: Black Meddle Pt. 2", 9),
        ("Addicts: Black Meddle Pt. II", 4),
        ("Addicts: Black Meddle, Pt. II", 2),
        ("Addicts: Black Meddle Part II", 1),
    ];

    fn addicts(conn: &Connection) {
        for (album, plays) in ADDICTS {
            heard(conn, "Nachtmystium", album, plays);
        }
    }

    fn linked(conn: &Connection, started_at: i64) -> Option<i64> {
        conn.query_row(
            "SELECT track_id FROM plays WHERE started_at = ?1",
            [started_at],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn a_key_folds_only_what_it_is_meant_to() {
        let cases = [
            // Case folds past ASCII, which is the whole reason this is not
            // `lower()` in SQL.
            (
                ("Motörhead", "Ace of Spades"),
                ("MOTÖRHEAD", "ACE OF SPADES"),
            ),
            (
                ("Sigur Rós", "Svefn-g-englar"),
                ("SIGUR RÓS", "Svefn-G-Englar"),
            ),
            // Whitespace a tag editor leaves behind.
            (
                ("Boards of Canada", "Roygbiv"),
                ("  Boards   of Canada ", "Roygbiv\t"),
            ),
            // The one suffix that names the same song.
            (
                ("Kanye West", "Stronger"),
                ("Kanye West", "Stronger (feat. Daft Punk)"),
            ),
            (
                ("Kanye West", "Stronger"),
                ("Kanye West", "Stronger (with Daft Punk)"),
            ),
            (
                ("Kanye West", "Stronger"),
                ("Kanye West", "Stronger (ft. Daft Punk)"),
            ),
        ];
        for (left, right) in cases {
            assert_eq!(
                match_key(left.0, left.1),
                match_key(right.0, right.1),
                "{left:?} and {right:?} are one song"
            );
        }

        // A different recording is a different song, and the MBIDs exist to
        // keep the distinction.
        assert_ne!(
            match_key("Talk Talk", "Ascension Day"),
            match_key("Talk Talk", "Ascension Day (Live)")
        );
        assert_ne!(
            match_key("Talk Talk", "Ascension Day"),
            match_key("Talk Talk", "Ascension Day (Remastered)")
        );

        // The separator is doing its job.
        assert_ne!(match_key("ab", "c"), match_key("a", "bc"));
    }

    #[test]
    fn an_album_key_folds_every_cause_the_log_shows() {
        let cases = [
            // Roman against arabic, and `Part` against `Pt.` - the whole of
            // the Nachtmystium group, 1,112 plays over four spellings.
            (
                ("Nachtmystium", "Addicts: Black Meddle Pt. 2"),
                ("Nachtmystium", "Addicts: Black Meddle Pt. II"),
            ),
            (
                ("Nachtmystium", "Addicts: Black Meddle Pt. 2"),
                ("Nachtmystium", "Addicts: Black Meddle, Pt. II"),
            ),
            (
                ("Nachtmystium", "Addicts: Black Meddle Pt. 2"),
                ("Nachtmystium", "Addicts: Black Meddle Part II"),
            ),
            // Diacritics, which is why this is not `lower()` in SQL.
            (
                ("Alcest", "Confessions D'Un Voleur D'Ames"),
                ("Alcest", "Confessions d'un Voleur D'âmes"),
            ),
            // Non-ASCII case, for the same reason.
            (
                ("Sigur Rós", "Ágætis Byrjun"),
                ("SIGUR RÓS", "ÁGÆTIS BYRJUN"),
            ),
            // One codepoint that only compatibility decomposition turns into
            // three, and the whole of the Marathonmann group.
            (
                ("Marathonmann", "Holzschwert…"),
                ("Marathonmann", "Holzschwert..."),
            ),
            // A parenthesised or bracketed edition marker, the biggest cause
            // at 155 groups.
            (
                ("Deftones", "White Pony"),
                ("Deftones", "White Pony (Deluxe Edition)"),
            ),
            (
                ("Deftones", "White Pony"),
                ("Deftones", "White Pony [20th Anniversary Remaster]"),
            ),
            (
                ("Deftones", "White Pony"),
                ("Deftones", "White Pony (Explicit)"),
            ),
            // The suffix a streaming service appends instead.
            (
                ("Deftones", "White Pony"),
                ("Deftones", "White Pony - Deluxe Edition"),
            ),
            (("Burial", "Truant"), ("Burial", "Truant - EP")),
            (("Burial", "Truant"), ("Burial", "Truant - Single")),
            (
                ("Deftones", "White Pony"),
                ("Deftones", "White Pony - Remastered 2020"),
            ),
            // Punctuation alone, 46 groups.
            (
                ("Godspeed You! Black Emperor", "F♯A♯∞"),
                ("Godspeed You Black Emperor", "F♯ A♯ ∞"),
            ),
        ];
        for (left, right) in cases {
            assert_eq!(
                album_key(left.0, left.1),
                album_key(right.0, right.1),
                "{left:?} and {right:?} are one album"
            );
        }
    }

    /// The vocabulary stops where `match_key`'s does, and for its reason: a
    /// key that matched too much attributes plays to a record nobody heard.
    #[test]
    fn an_album_key_keeps_apart_what_is_not_one_album() {
        // The numbered parts of one series.
        assert_ne!(
            album_key("Nachtmystium", "Black Meddle Pt. 1"),
            album_key("Nachtmystium", "Black Meddle Pt. 2")
        );
        assert_ne!(
            album_key("Nachtmystium", "Black Meddle Pt. I"),
            album_key("Nachtmystium", "Black Meddle Pt. II")
        );
        // `version` and `special` are deliberately out of the vocabulary:
        // stripping a bare `(… Version)` folds the live cut into the studio
        // one, which is the failure `match_key` refuses.
        assert_ne!(
            album_key("Talk Talk", "Laughing Stock"),
            album_key("Talk Talk", "Laughing Stock (Live Version)")
        );
        assert_ne!(
            album_key("Talk Talk", "Laughing Stock"),
            album_key("Talk Talk", "Laughing Stock (Acoustic Version)")
        );
        // Two bands with one album title are two albums.
        assert_ne!(
            album_key("Boards of Canada", "Twoism"),
            album_key("Nachtmystium", "Twoism")
        );
        // The separator is doing its job.
        assert_ne!(album_key("ab", "c"), album_key("a", "bc"));
    }

    /// An untitled album is not a group. `top` never draws one, and a key
    /// built from the artist alone would gather every untitled play under it.
    #[test]
    fn a_play_with_no_album_has_no_key() {
        for album in ["", "   ", "()", " - "] {
            assert_eq!(album_key("Boards of Canada", album), "", "{album:?}");
        }
    }

    #[test]
    fn a_key_built_from_nothing_is_empty_rather_than_broad() {
        for (artist, title) in [
            ("", "Roygbiv"),
            ("Boards of Canada", ""),
            ("", ""),
            ("  ", "\t"),
        ] {
            assert_eq!(match_key(artist, title), "");
        }
    }

    #[test]
    fn a_play_lands_with_the_tags_it_was_played_under() {
        let (_dir, conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));

        record(&conn, 1, 1_700_000_000).unwrap();

        let (artist, title, source, duration_ms, track_id): (
            String,
            String,
            String,
            i64,
            Option<i64>,
        ) = conn
            .query_row(
                "SELECT artist, title, source, duration_ms, track_id FROM plays",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            (
                artist.as_str(),
                title.as_str(),
                source.as_str(),
                duration_ms,
                track_id
            ),
            ("Blue Room", "Harbour", "local", 240_000, Some(1))
        );
    }

    /// The rules the scrobbler applies are last.fm's conditions for accepting
    /// a scrobble, not this app's for remembering a play.
    #[test]
    fn an_untagged_track_is_logged_and_left_unmatched() {
        let (_dir, conn) = open();
        add_track(&conn, 1, None, None);

        record(&conn, 1, 1_700_000_000).unwrap();
        resolve(&conn).unwrap();

        let (artist, key) = conn
            .query_row("SELECT artist, match_key FROM plays", [], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap();
        assert_eq!((artist.as_str(), key.as_str()), ("", ""));
        assert_eq!(linked(&conn, 1_700_000_000), None);
    }

    /// The failure this guards against is a lost play count, not a lost row:
    /// the insert shares a transaction with `mark_played`, so a constraint
    /// violation would take the increment with it.
    #[test]
    fn a_second_play_of_the_same_second_is_ignored_rather_than_an_error() {
        let (_dir, mut conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));

        let tx = conn.transaction().unwrap();
        playback::mark_played(&tx, 1, 1_700_000_500).unwrap();
        record(&tx, 1, 1_700_000_000).unwrap();
        playback::mark_played(&tx, 1, 1_700_000_500).unwrap();
        record(&tx, 1, 1_700_000_000).unwrap();
        tx.commit().unwrap();

        let plays: i64 = conn
            .query_row("SELECT count(*) FROM plays", [], |r| r.get(0))
            .unwrap();
        let count: i64 = conn
            .query_row("SELECT play_count FROM tracks WHERE id = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!((plays, count), (1, 2));
    }

    #[test]
    fn a_play_with_no_matching_file_stays_unmatched() {
        let (_dir, conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));
        conn.execute(
            "INSERT INTO plays (started_at, source, artist, title, match_key)
             VALUES (1, 'lastfm', 'Nobody', 'Nothing', ?1)",
            [match_key("Nobody", "Nothing")],
        )
        .unwrap();

        resolve(&conn).unwrap();

        assert_eq!(linked(&conn, 1), None);
    }

    #[test]
    fn deleting_a_file_forgets_the_link_and_keeps_the_play() {
        let (_dir, conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));
        record(&conn, 1, 1_700_000_000).unwrap();

        conn.execute("DELETE FROM tracks WHERE id = 1", []).unwrap();

        // `ON DELETE SET NULL` gets there before any rebuild does, which is
        // what keeps the log readable between one and the next.
        assert_eq!(linked(&conn, 1_700_000_000), None);
        let rows: i64 = conn
            .query_row("SELECT count(*) FROM plays", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn retagging_a_file_re_points_the_plays_that_name_it() {
        let (_dir, conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));
        add_track(&conn, 2, Some("Nobody"), Some("Nothing"));
        record(&conn, 1, 1_700_000_000).unwrap();

        conn.execute(
            "UPDATE tracks SET artist = 'Nobody', title = 'Nothing' WHERE id = 1",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE tracks SET artist = 'Blue Room', title = 'Harbour' WHERE id = 2",
            [],
        )
        .unwrap();
        resolve(&conn).unwrap();

        assert_eq!(linked(&conn, 1_700_000_000), Some(2));
    }

    /// The album copy and the compilation copy of one song. Which one a play
    /// lands on has to be the same answer every time, or `resolve` writes the
    /// whole table on every run.
    #[test]
    fn one_key_over_two_files_picks_the_present_one_then_the_older_id() {
        let (_dir, conn) = open();
        add_track(&conn, 7, Some("Blue Room"), Some("Harbour"));
        add_track(&conn, 9, Some("Blue Room"), Some("Harbour"));
        record(&conn, 9, 1_700_000_000).unwrap();

        resolve(&conn).unwrap();
        assert_eq!(linked(&conn, 1_700_000_000), Some(7), "the older id wins");

        conn.execute("UPDATE tracks SET missing_since = 1 WHERE id = 7", [])
            .unwrap();
        resolve(&conn).unwrap();
        assert_eq!(
            linked(&conn, 1_700_000_000),
            Some(9),
            "a present file beats an unplugged one"
        );
    }

    /// `heading` is a spelling out of the user's own history and never an
    /// invented title: MusicBrainz calls this release `Addicts: Black Meddle,
    /// Part 2`, a fifth spelling none of the plays carry.
    #[test]
    fn a_pass_names_a_group_after_its_most_played_spelling() {
        let (_dir, conn) = open();
        addicts(&conn);

        regroup(&conn).unwrap();

        for (album, _) in ADDICTS {
            assert_eq!(
                heading(&conn, "Nachtmystium", album).as_deref(),
                Some("Addicts: Black Meddle Pt. 2"),
                "{album:?}"
            );
        }
    }

    /// The correction survives the pass, and it claims the group - otherwise a
    /// retitled group would revert the moment a new spelling arrived.
    #[test]
    fn a_pinned_heading_survives_a_pass_and_claims_the_rest_of_its_key() {
        let (_dir, conn) = open();
        addicts(&conn);
        regroup(&conn).unwrap();

        pin(
            &conn,
            "Nachtmystium",
            "Addicts: Black Meddle Pt. 2",
            "Addicts: Black Meddle",
        );
        heard(
            &conn,
            "Nachtmystium",
            "Addicts: Black Meddle Pt. 2 (Deluxe)",
            3,
        );
        regroup(&conn).unwrap();

        for (album, _) in ADDICTS {
            assert_eq!(
                heading(&conn, "Nachtmystium", album).as_deref(),
                Some("Addicts: Black Meddle"),
                "{album:?}"
            );
        }
        assert_eq!(
            heading(
                &conn,
                "Nachtmystium",
                "Addicts: Black Meddle Pt. 2 (Deluxe)"
            )
            .as_deref(),
            Some("Addicts: Black Meddle"),
            "a spelling that arrived after the correction joins it"
        );
    }

    /// Separating a spelling out is the same write as the other two - pin a
    /// row with a heading - and the heading it is pinned with is its own. The
    /// rest of the key must not follow it out, even when it is the biggest.
    #[test]
    fn a_spelling_pinned_to_itself_leaves_the_group_behind() {
        let (_dir, conn) = open();
        addicts(&conn);
        regroup(&conn).unwrap();

        pin(
            &conn,
            "Nachtmystium",
            "Addicts: Black Meddle Pt. 2",
            "Addicts: Black Meddle Pt. 2",
        );
        regroup(&conn).unwrap();

        assert_eq!(
            heading(&conn, "Nachtmystium", "Addicts: Black Meddle Pt. II").as_deref(),
            Some("Addicts: Black Meddle Pt. II"),
            "the rest name themselves after their own biggest"
        );
        assert_eq!(
            heading(&conn, "Nachtmystium", "Addicts: Black Meddle, Pt. II").as_deref(),
            Some("Addicts: Black Meddle Pt. II")
        );
    }

    /// Merging is the third face of the same write: a row pinned with another
    /// group's heading reads under it, whatever its own key folds to.
    #[test]
    fn a_row_pinned_with_another_groups_heading_keeps_it() {
        let (_dir, conn) = open();
        addicts(&conn);
        heard(&conn, "Nachtmystium", "Black Meddle Anthology", 2);
        regroup(&conn).unwrap();

        pin(
            &conn,
            "Nachtmystium",
            "Black Meddle Anthology",
            "Addicts: Black Meddle Pt. 2",
        );
        regroup(&conn).unwrap();

        assert_eq!(
            heading(&conn, "Nachtmystium", "Black Meddle Anthology").as_deref(),
            Some("Addicts: Black Meddle Pt. 2")
        );
    }

    #[test]
    fn a_play_with_no_album_is_not_a_group() {
        let (_dir, conn) = open();
        heard(&conn, "Boards of Canada", "", 2);
        conn.execute(
            "INSERT INTO plays (started_at, source, artist, title, album, match_key)
             VALUES (99, 'lastfm', 'Boards of Canada', 'Roygbiv', NULL, 'x')",
            [],
        )
        .unwrap();

        regroup(&conn).unwrap();

        let rows: i64 = conn
            .query_row("SELECT count(*) FROM album_groups", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 0);
    }

    /// A library that has imported once already never sees `regroup` again
    /// unless the vocabulary moves, so the fold's own version is what asks
    /// for the pass.
    #[test]
    fn a_fold_that_has_moved_regroups_once_and_then_leaves_it() {
        let (_dir, conn) = open();
        addicts(&conn);

        assert!(regroup_if_stale(&conn).unwrap());
        assert_eq!(
            heading(&conn, "Nachtmystium", "Addicts: Black Meddle Part II").as_deref(),
            Some("Addicts: Black Meddle Pt. 2")
        );

        assert!(!regroup_if_stale(&conn).unwrap(), "once per fold");

        crate::db::settings::set(&conn, crate::db::settings::ALBUM_FOLD, "0").unwrap();
        assert!(regroup_if_stale(&conn).unwrap(), "a moved fold asks again");
    }

    #[test]
    fn a_second_pass_over_an_unchanged_log_writes_nothing() {
        let (_dir, conn) = open();
        addicts(&conn);
        regroup(&conn).unwrap();

        assert_eq!(regroup(&conn).unwrap(), 0);
    }

    /// Between passes, so the row a play lands under exists the moment it is
    /// played rather than after the next import.
    #[test]
    fn a_local_play_joins_the_group_its_spelling_folds_into() {
        let (_dir, conn) = open();
        addicts(&conn);
        regroup(&conn).unwrap();
        add_track(&conn, 1, Some("Nachtmystium"), Some("Every Last Drop"));
        conn.execute(
            "UPDATE tracks SET album = 'Addicts: Black Meddle Pt. 2 (Remastered)' WHERE id = 1",
            [],
        )
        .unwrap();

        record(&conn, 1, 1_700_000_000).unwrap();

        assert_eq!(
            heading(
                &conn,
                "Nachtmystium",
                "Addicts: Black Meddle Pt. 2 (Remastered)"
            )
            .as_deref(),
            Some("Addicts: Black Meddle Pt. 2")
        );
    }

    #[test]
    fn a_local_play_of_an_album_nothing_knows_names_itself() {
        let (_dir, conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));
        conn.execute("UPDATE tracks SET album = 'Lighthouse' WHERE id = 1", [])
            .unwrap();

        record(&conn, 1, 1_700_000_000).unwrap();

        assert_eq!(
            heading(&conn, "Blue Room", "Lighthouse").as_deref(),
            Some("Lighthouse")
        );
    }

    #[test]
    fn a_rebuild_over_an_unchanged_library_writes_nothing() {
        let (_dir, conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));
        add_track(&conn, 2, None, None);
        record(&conn, 1, 1_700_000_000).unwrap();
        record(&conn, 2, 1_700_000_100).unwrap();
        resolve(&conn).unwrap();

        assert_eq!(resolve(&conn).unwrap(), 0);
    }
}
