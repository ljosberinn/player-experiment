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
/// **Deliberately conservative**: case, punctuation, diacritics and script
/// folded through [`decompose`] and [`squeeze`], and a trailing `(feat. …)` or
/// `(with …)` dropped. Nothing else. Folding `(Live)` into the studio cut
/// would destroy a distinction the MBIDs exist to preserve, and a key that
/// matched too much is worse than one that matches nothing - it attributes
/// plays to a song the user never heard.
///
/// **Punctuation is inside that boundary, and was not always.** The key was
/// case and whitespace alone until issue 120, which measured 9,282 unlinked
/// plays over a 237,728-play log: a typographic apostrophe in a tag against an
/// ASCII one in a scrobble, `Paper Thin Hotel` against `Paper-Thin Hotel`, and
/// NFC against NFD in the same string. It costs two tracks whose titles are
/// punctuation the artist chose - see [`MATCH_FOLD_VERSION`], which is what
/// tells an existing library to fold again.
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

/// [`match_key`] as `tracks.match_key` stores it: `None` rather than empty, so
/// an untagged file is never in the loved set by sharing a blank key with it.
pub fn track_key(artist: Option<&str>, title: Option<&str>) -> Option<String> {
    let key = match_key(artist.unwrap_or_default(), title.unwrap_or_default());
    (!key.is_empty()).then_some(key)
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
///
/// **The order is load-bearing in both directions.** [`without_featuring`]
/// matches its openers lowercase, so it runs after [`decompose`]; and it
/// matches on parentheses, which [`squeeze`] deletes, so it runs before that.
///
/// **A side that squeezes to nothing keeps its unsqueezed spelling.** `!!!`,
/// `†††` and the title `?` are alphanumeric-free, and an empty side empties
/// the whole key - which [`resolve`] skips. They link today and must go on
/// linking; `…` against `...` still folds, which is more than the key managed
/// before.
fn normalize(value: &str) -> String {
    let decomposed = decompose(value);
    let folded = without_featuring(decomposed.trim()).trim_end();
    match squeeze(folded) {
        squeezed if squeezed.is_empty() => folded.to_owned(),
        squeezed => squeezed,
    }
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
    // One transaction rather than a commit per key, which is what the
    // temporary table's inserts cost where a scan or a removal calls this
    // bare (issue 166). A savepoint for `regroup`'s reason.
    conn.execute_batch("SAVEPOINT resolve")?;
    match resolve_within(conn) {
        Ok(moved) => {
            conn.execute_batch("RELEASE resolve")?;
            Ok(moved)
        }
        Err(error) => {
            conn.execute_batch("ROLLBACK TO resolve; RELEASE resolve")?;
            Err(error)
        }
    }
}

fn resolve_within(conn: &Connection) -> AppResult<u32> {
    use std::collections::{HashMap, HashSet};

    conn.execute_batch(
        "DROP TABLE IF EXISTS temp.play_keys;
         CREATE TEMP TABLE play_keys (
             key      TEXT PRIMARY KEY,
             track_id INTEGER NOT NULL
         ) WITHOUT ROWID;
         DROP TABLE IF EXISTS temp.album_links;
         CREATE TEMP TABLE album_links (
             play_id  INTEGER PRIMARY KEY,
             track_id INTEGER NOT NULL
         );",
    )?;

    // (album, title) to the track `play_keys`' tiebreak picks, and every
    // library artist a track under that pair names.
    let mut albums: HashMap<(String, String), (i64, HashSet<String>)> = HashMap::new();
    // Each album spelling is folded once: a log repeats them by the thousand.
    let mut folds: HashMap<String, String> = HashMap::new();
    {
        // **Which track wins a key is fixed rather than incidental.** The same
        // song on its album and on a compilation is two rows and one key, and
        // a library has hundreds of those. Present beats unplugged and the
        // older id beats the newer, which is migration 12's tiebreak for the
        // same reason it was chosen there: without one the winner follows scan
        // order, this function stops being idempotent, and the guarded UPDATE
        // below rewrites the whole table on every run.
        let mut tracks = conn.prepare(
            "SELECT id, artist, title, album_artist, album FROM tracks
              ORDER BY missing_since IS NOT NULL, id",
        )?;
        let mut insert =
            conn.prepare("INSERT OR IGNORE INTO temp.play_keys (key, track_id) VALUES (?1, ?2)")?;

        // **The album artist is a fallback, inserted after every artist key.**
        // last.fm credits the primary artist and moves a guest into the title,
        // so `Prezident mit Absztrakkt` on the file is `Prezident` in the log,
        // and the album artist is the one field that says so. Going second
        // lets an artist key win any key both produce, so no link that is
        // right today moves (issue 135).
        let mut fallbacks: Vec<(String, i64)> = Vec::new();
        let mut rows = tracks.query([])?;
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let artist: Option<String> = row.get(1)?;
            let title: Option<String> = row.get(2)?;
            let album_artist: Option<String> = row.get(3)?;
            let album: String = row.get::<_, Option<String>>(4)?.unwrap_or_default();
            let artist = artist.as_deref().unwrap_or_default();
            let album_artist = album_artist.as_deref().unwrap_or_default();
            let title = title.as_deref().unwrap_or_default();
            let key = match_key(artist, title);
            if !key.is_empty() {
                insert.execute(rusqlite::params![key, id])?;
            }
            let fallback = match_key(album_artist, title);
            if !fallback.is_empty() && fallback != key {
                fallbacks.push((fallback, id));
            }

            let owner = normalize(if album_artist.trim().is_empty() {
                artist
            } else {
                album_artist
            });
            let pair = (
                folds
                    .entry(album)
                    .or_insert_with_key(|album| fold_album(album))
                    .clone(),
                normalize(title),
            );
            if !owner.is_empty() && !pair.0.is_empty() && !pair.1.is_empty() {
                albums
                    .entry(pair)
                    .or_insert_with(|| (id, HashSet::new()))
                    .1
                    .insert(owner);
            }
        }
        for (key, id) in &fallbacks {
            insert.execute(rusqlite::params![key, id])?;
        }
    }

    // **The album on the play is the last resort, and it has to be
    // corroborated.** last.fm merges some artists into others - `Disko
    // Degenhardt` scrobbles as `Franz Josef Degenhardt` - so no key the play
    // carries names the file. Two titles of one scrobbled album landing on one
    // library artist's copy of it is the evidence; one title alone links a
    // cover or a title track to a song that was never heard (issue 145).
    {
        type Hit<'a> = (i64, String, i64, &'a HashSet<String>);
        let mut groups: HashMap<(String, String), Vec<Hit>> = HashMap::new();
        let mut plays = conn.prepare(
            "SELECT id, artist, title, album FROM plays
              WHERE match_key <> '' AND album <> ''
                AND match_key NOT IN (SELECT key FROM temp.play_keys)",
        )?;
        let mut rows = plays.query([])?;
        while let Some(row) = rows.next()? {
            let album = folds
                .entry(row.get(3)?)
                .or_insert_with_key(|album| fold_album(album))
                .clone();
            let title = normalize(&row.get::<_, String>(2)?);
            if album.is_empty() || title.is_empty() {
                continue;
            }
            let pair = (album, title);
            let Some((track_id, owners)) = albums.get(&pair) else {
                continue;
            };
            let (album, title) = pair;
            groups
                .entry((normalize(&row.get::<_, String>(1)?), album))
                .or_default()
                .push((row.get(0)?, title, *track_id, owners));
        }

        let mut link =
            conn.prepare("INSERT INTO temp.album_links (play_id, track_id) VALUES (?1, ?2)")?;
        for hits in groups.values() {
            let titles: HashSet<&str> = hits.iter().map(|hit| hit.1.as_str()).collect();
            let owners: HashSet<&String> = hits.iter().flat_map(|hit| hit.3.iter()).collect();
            if titles.len() < 2 || owners.len() != 1 {
                continue;
            }
            for (play_id, _, track_id, _) in hits {
                link.execute([play_id, track_id])?;
            }
        }
    }

    // **The guard is what makes the full scan affordable.** After a three-track
    // tag edit the statement still reads every play, but it writes only the
    // handful whose link actually moved, instead of rewriting a quarter of a
    // million rows to the values they already held.
    //
    // `IS NOT` rather than `<>` because most of those values are NULL on both
    // sides, and `<>` is NULL there rather than false.
    //
    // One assignment for every tier: a second `UPDATE` for the album links
    // would find each of them nulled by this one and write it back, every run.
    let moved = conn.execute(
        "UPDATE plays
            SET track_id = coalesce(
                (SELECT k.track_id FROM temp.play_keys k WHERE k.key = plays.match_key),
                (SELECT a.track_id FROM temp.album_links a WHERE a.play_id = plays.id))
          WHERE match_key <> ''
            AND track_id IS NOT coalesce(
                (SELECT k.track_id FROM temp.play_keys k WHERE k.key = plays.match_key),
                (SELECT a.track_id FROM temp.album_links a WHERE a.play_id = plays.id))",
        [],
    )?;

    conn.execute_batch("DROP TABLE temp.play_keys; DROP TABLE temp.album_links;")?;
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
    // A savepoint rather than a transaction because the import calls this
    // inside its own, and startup and a pin call it bare.
    conn.execute_batch("SAVEPOINT regroup")?;
    match regroup_within(conn) {
        Ok(moved) => {
            conn.execute_batch("RELEASE regroup")?;
            Ok(moved)
        }
        Err(error) => {
            conn.execute_batch("ROLLBACK TO regroup; RELEASE regroup")?;
            Err(error)
        }
    }
}

fn regroup_within(conn: &Connection) -> AppResult<u32> {
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

/// Which [`match_key`] the stored keys are expected to have been built with,
/// and which keys [`resolve`] links a track through.
///
/// **Bump this whenever the fold changes what it folds together**, for the
/// reason [`FOLD_VERSION`] gives - and more sharply, because this key is
/// stored rather than derived on read. A library whose keys predate the fold
/// does not half-link; it does not link at all. Bump it too when `resolve`
/// gives a track another key, as 3 did for the album artist and 4 for the
/// album: the stored keys stay put, but nothing else resolves at launch.
const MATCH_FOLD_VERSION: &str = "4";

/// Rewrites every stored `match_key` with the current fold, returning how many
/// rows moved.
///
/// `plays` and `tracks` recompute from their own `artist` and `title`. `loved`
/// has neither column, so it folds the stored key in place, a side at a time:
/// the new fold refines the old one, so folding an old key again lands where
/// folding the original tags would - but [`squeeze`] eats [`SEPARATOR`], so
/// the key cannot be folded whole.
///
/// `tracks` counts its rows apart from the rest: a key written for the first
/// time is how migration 18's column is backfilled, and the caller has to know
/// the loved set moved.
///
/// **Every table is read to the end before any is written.** The `plays`
/// pass updates the table its own cursor is reading, and `UPDATE OR REPLACE`
/// can delete a row the cursor has not reached yet.
///
/// `UPDATE OR REPLACE` because `idx_plays_identity` can collide: two spellings
/// of one song scrobbled in the same second are one play, and dropping the
/// loser is what that index is for. Nothing carries a foreign key onto
/// `plays.id`, so the dropped row orphans nothing.
pub fn refold(conn: &mut Connection) -> AppResult<Refolded> {
    let tx = conn.transaction()?;

    let mut rewritten: Vec<(i64, String)> = Vec::new();
    {
        let mut statement = tx.prepare("SELECT id, artist, title, match_key FROM plays")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let folded = match_key(&row.get::<_, String>(1)?, &row.get::<_, String>(2)?);
            if folded != row.get::<_, String>(3)? {
                rewritten.push((row.get(0)?, folded));
            }
        }
    }

    let mut retagged: Vec<(i64, Option<String>)> = Vec::new();
    {
        let mut statement = tx.prepare("SELECT id, artist, title, match_key FROM tracks")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let folded = track_key(
                row.get::<_, Option<String>>(1)?.as_deref(),
                row.get::<_, Option<String>>(2)?.as_deref(),
            );
            if folded != row.get::<_, Option<String>>(3)? {
                retagged.push((row.get(0)?, folded));
            }
        }
    }

    let mut refolded: Vec<(String, String)> = Vec::new();
    {
        let mut statement = tx.prepare("SELECT match_key FROM loved")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let stored: String = row.get(0)?;
            let Some((artist, title)) = stored.split_once(SEPARATOR) else {
                continue;
            };
            let folded = match_key(artist, title);
            if folded != stored && !folded.is_empty() {
                refolded.push((stored, folded));
            }
        }
    }

    let mut moved = 0;
    {
        let mut update = tx.prepare("UPDATE OR REPLACE plays SET match_key = ?2 WHERE id = ?1")?;
        for (id, folded) in &rewritten {
            update.execute(rusqlite::params![id, folded])?;
            moved += 1;
        }

        let mut retag = tx.prepare("UPDATE tracks SET match_key = ?2 WHERE id = ?1")?;
        for (id, folded) in &retagged {
            retag.execute(rusqlite::params![id, folded])?;
        }

        // Insert before delete, so a fold that lands on a key already loved
        // keeps the love rather than dropping both spellings of it. The
        // `remote` flag travels with the key: it is still the song last.fm
        // reported.
        let mut insert = tx.prepare(
            "INSERT OR IGNORE INTO loved (match_key, remote)
             SELECT ?1, remote FROM loved WHERE match_key = ?2",
        )?;
        let mut delete = tx.prepare("DELETE FROM loved WHERE match_key = ?1")?;
        for (stored, folded) in &refolded {
            insert.execute([folded, stored])?;
            delete.execute([stored])?;
            moved += 1;
        }
    }

    tx.commit()?;
    Ok(Refolded {
        moved,
        tracks: retagged.len() as u32,
    })
}

/// What [`refold`] rewrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Refolded {
    /// Plays and loved keys.
    pub moved: u32,
    /// Library tracks, whose keys are what the loved set resolves through.
    pub tracks: u32,
}

/// Runs [`refold`] if this library's keys predate [`MATCH_FOLD_VERSION`],
/// answering what it rewrote, or `None` when the keys were current.
///
/// A marker rather than a migration, in [`regroup_if_stale`]'s shape and for
/// its reason.
///
/// **It runs [`resolve`] itself.** Nothing else resolves at launch - the
/// callers are the scan, the import and a tag write - so a pass that stopped
/// at the keys would leave every newly foldable play unlinked until the user
/// next scanned or imported. Before the marker, so a failure in either is
/// retried on the next launch.
pub fn refold_if_stale(conn: &mut Connection) -> AppResult<Option<Refolded>> {
    use crate::db::settings;

    if settings::get(conn, settings::MATCH_FOLD)?.as_deref() == Some(MATCH_FOLD_VERSION) {
        return Ok(None);
    }
    let refolded = refold(conn)?;
    resolve(conn)?;
    settings::set(conn, settings::MATCH_FOLD, MATCH_FOLD_VERSION)?;
    Ok(Some(refolded))
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
            // Capitalised, which is what pins `without_featuring` after
            // `decompose` rather than before it.
            (
                ("Kanye West", "Stronger"),
                ("Kanye West", "Stronger (Feat. Daft Punk)"),
            ),
            // The four causes issue 120 measured, largest first. The
            // apostrophe is on the artist side, so nothing about the band
            // linked at all.
            (
                ("The Devil's Blood", "Die Old"),
                ("The Devil\u{2019}s Blood", "Die Old"),
            ),
            (
                ("King Dude", "Death Won't Take Me"),
                ("King Dude", "Death Won\u{2019}t Take Me"),
            ),
            (
                ("Leonard Cohen", "Paper Thin Hotel"),
                ("Leonard Cohen", "Paper-Thin Hotel"),
            ),
            (
                ("The Ruins of Beverast", "Theriak - Baal - Theriak"),
                (
                    "The Ruins of Beverast",
                    "Theriak \u{2013} Baal \u{2013} Theriak",
                ),
            ),
            // NFC against NFD in the same string - both spellings are on disk.
            (
                ("Sopor Aeternus", "Monumentale Schw\u{e4}rze"),
                ("Sopor Aeternus", "Monumentale Schwa\u{308}rze"),
            ),
            // A diacritic the scrobble dropped and the tag kept.
            (
                ("Mot\u{f6}rhead", "Ace of Spades"),
                ("Motorhead", "Ace of Spades"),
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
    fn a_side_of_punctuation_alone_still_makes_a_key() {
        // `squeeze` drops everything non-alphanumeric, and an empty side
        // empties the whole key - which `resolve` skips on `match_key <> ''`.
        // These link today and have to go on linking.
        for (artist, title) in [
            ("!!!", "Me and Giuliani Down by the School Yard"),
            ("Crosses", "\u{2020}"),
            ("Boards of Canada", "?"),
        ] {
            assert!(
                !match_key(artist, title).is_empty(),
                "{artist:?} - {title:?}"
            );
        }

        // And the fallback still folds what decomposition agrees about.
        assert_eq!(
            match_key("Boards of Canada", "\u{2026}"),
            match_key("Boards of Canada", "...")
        );
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

    /// A file whose artist field carries the guest. last.fm credits the
    /// primary artist and moves the guest into the title, so only the album
    /// artist produces the scrobble's key.
    fn prometheus(conn: &Connection, id: i64) {
        add_track(
            conn,
            id,
            Some("Prezident mit Absztrakkt"),
            Some("Prometheus"),
        );
        conn.execute(
            "UPDATE tracks SET album_artist = 'Prezident' WHERE id = ?1",
            [id],
        )
        .unwrap();
    }

    fn played(conn: &Connection, started_at: i64, artist: &str, title: &str) {
        conn.execute(
            "INSERT INTO plays (started_at, source, artist, title, match_key)
             VALUES (?1, 'lastfm', ?2, ?3, ?4)",
            rusqlite::params![started_at, artist, title, match_key(artist, title)],
        )
        .unwrap();
    }

    #[test]
    fn a_play_credited_to_the_album_artist_links_to_the_file() {
        let (_dir, conn) = open();
        prometheus(&conn, 1);
        played(&conn, 10, "Prezident", "Prometheus");

        resolve(&conn).unwrap();
        assert_eq!(linked(&conn, 10), Some(1));
        assert_eq!(resolve(&conn).unwrap(), 0, "a second pass moves nothing");
    }

    /// The older id would win a single pass; the artist key has to win
    /// regardless, or links that are right today move.
    #[test]
    fn an_artist_key_beats_another_tracks_album_artist_key() {
        let (_dir, conn) = open();
        prometheus(&conn, 1);
        add_track(&conn, 2, Some("Prezident"), Some("Prometheus"));
        played(&conn, 10, "Prezident", "Prometheus");

        resolve(&conn).unwrap();
        assert_eq!(linked(&conn, 10), Some(2));
    }

    fn on_album(conn: &Connection, id: i64, artist: &str, album: &str, title: &str) {
        add_track(conn, id, Some(artist), Some(title));
        conn.execute(
            "UPDATE tracks SET album = ?2 WHERE id = ?1",
            rusqlite::params![id, album],
        )
        .unwrap();
    }

    fn played_on(conn: &Connection, started_at: i64, artist: &str, album: &str, title: &str) {
        conn.execute(
            "INSERT INTO plays (started_at, source, artist, title, album, match_key)
             VALUES (?1, 'lastfm', ?2, ?3, ?4, ?5)",
            rusqlite::params![started_at, artist, title, album, match_key(artist, title)],
        )
        .unwrap();
    }

    /// last.fm merges the rapper into the folk singer, so no key a play
    /// carries names the file.
    fn harmonie(conn: &Connection) {
        on_album(conn, 1, "Disko Degenhardt", "Harmonie Hurensohn 2", "Mods");
        on_album(
            conn,
            2,
            "Disko Degenhardt",
            "Harmonie Hurensohn 2",
            "Kontrolle",
        );
    }

    #[test]
    fn two_titles_of_one_album_under_a_wrong_artist_link() {
        let (_dir, conn) = open();
        harmonie(&conn);
        played_on(
            &conn,
            10,
            "Franz Josef Degenhardt",
            "Harmonie Hurensohn 2",
            "mods",
        );
        played_on(
            &conn,
            11,
            "Franz Josef Degenhardt",
            "Harmonie Hurensohn 2",
            "Mods",
        );
        played_on(
            &conn,
            12,
            "Franz Josef Degenhardt",
            "Harmonie Hurensohn 2",
            "Kontrolle",
        );

        resolve(&conn).unwrap();
        assert_eq!(
            [linked(&conn, 10), linked(&conn, 11), linked(&conn, 12)],
            [Some(1), Some(1), Some(2)]
        );
        assert_eq!(resolve(&conn).unwrap(), 0, "a second pass moves nothing");
    }

    /// A title track or a cover: `Iggy Pop - Lust for Life` is on Lana Del
    /// Rey's album of that name too.
    #[test]
    fn one_title_of_an_album_alone_stays_unlinked() {
        let (_dir, conn) = open();
        on_album(&conn, 1, "Lana Del Rey", "Lust for Life", "Lust for Life");
        played_on(&conn, 10, "Iggy Pop", "Lust for Life", "Lust for Life");
        played_on(&conn, 11, "Iggy Pop", "Lust for Life", "Lust for Life");

        resolve(&conn).unwrap();
        assert_eq!([linked(&conn, 10), linked(&conn, 11)], [None, None]);
    }

    #[test]
    fn an_album_whose_titles_name_two_library_artists_stays_unlinked() {
        let (_dir, conn) = open();
        on_album(&conn, 1, "Blue Room", "Greatest Hits", "Harbour");
        on_album(&conn, 2, "Red Room", "Greatest Hits", "Tide");
        played_on(&conn, 10, "Nobody", "Greatest Hits", "Harbour");
        played_on(&conn, 11, "Nobody", "Greatest Hits", "Tide");

        resolve(&conn).unwrap();
        assert_eq!([linked(&conn, 10), linked(&conn, 11)], [None, None]);
    }

    /// The album never outvotes a key, and a play a key links is no
    /// corroboration for the rest of its album.
    #[test]
    fn a_play_a_key_links_is_not_moved_by_its_album() {
        let (_dir, conn) = open();
        harmonie(&conn);
        on_album(
            &conn,
            3,
            "Franz Josef Degenhardt",
            "Väterchen Franz",
            "Kontrolle",
        );
        played_on(
            &conn,
            10,
            "Franz Josef Degenhardt",
            "Harmonie Hurensohn 2",
            "Mods",
        );
        played_on(
            &conn,
            11,
            "Franz Josef Degenhardt",
            "Harmonie Hurensohn 2",
            "Kontrolle",
        );

        resolve(&conn).unwrap();
        assert_eq!([linked(&conn, 10), linked(&conn, 11)], [None, Some(3)]);
    }

    #[test]
    fn a_library_on_the_previous_fold_links_through_the_album_once() {
        let (_dir, mut conn) = open();
        harmonie(&conn);
        played_on(
            &conn,
            10,
            "Franz Josef Degenhardt",
            "Harmonie Hurensohn 2",
            "Mods",
        );
        played_on(
            &conn,
            11,
            "Franz Josef Degenhardt",
            "Harmonie Hurensohn 2",
            "Kontrolle",
        );
        crate::db::settings::set(&conn, crate::db::settings::MATCH_FOLD, "3").unwrap();

        assert!(refold_if_stale(&mut conn).unwrap().is_some());
        assert_eq!([linked(&conn, 10), linked(&conn, 11)], [Some(1), Some(2)]);
        assert_eq!(refold_if_stale(&mut conn).unwrap(), None, "once");
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

    /// One transaction whoever calls it: startup and a pin call it bare, and a
    /// commit per row is what made the pass sixty times dearer on CI than here.
    #[test]
    fn a_pass_that_fails_part_way_writes_nothing() {
        let (_dir, conn) = open();
        addicts(&conn);
        conn.execute_batch(
            "CREATE TEMP TRIGGER second_write_fails BEFORE INSERT ON album_groups
               WHEN (SELECT count(*) FROM album_groups) >= 1
               BEGIN SELECT RAISE(ABORT, 'refused'); END;",
        )
        .unwrap();

        assert!(regroup(&conn).is_err());
        assert!(conn.is_autocommit(), "the pass left a transaction open");
        let written: u32 = conn
            .query_row("SELECT count(*) FROM album_groups", [], |row| row.get(0))
            .unwrap();
        assert_eq!(written, 0);
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

    /// `match_key` as it was before issue 120 widened it: lowercase, collapsed
    /// whitespace and a trailing credit, and nothing about punctuation. What a
    /// library that imported its history before the fold moved has stored.
    fn stale_key(artist: &str, title: &str) -> String {
        fn stale(value: &str) -> String {
            let lowered = value.to_lowercase();
            let trimmed = without_featuring(lowered.trim());
            trimmed.split_whitespace().collect::<Vec<_>>().join(" ")
        }
        format!("{}{SEPARATOR}{}", stale(artist), stale(title))
    }

    fn scrobbled(conn: &Connection, started_at: i64, artist: &str, title: &str) {
        conn.execute(
            "INSERT INTO plays (started_at, source, artist, title, match_key)
             VALUES (?1, 'lastfm', ?2, ?3, ?4)",
            rusqlite::params![started_at, artist, title, stale_key(artist, title)],
        )
        .unwrap();
    }

    fn keys(conn: &Connection, table: &str) -> Vec<String> {
        conn.prepare(&format!("SELECT match_key FROM {table} ORDER BY match_key"))
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    }

    /// The whole point of the pass: the key is stored, so widening the fold
    /// links nothing until every stored copy is rewritten.
    #[test]
    fn a_fold_that_has_moved_relinks_the_plays_it_kept_apart() {
        let (_dir, mut conn) = open();
        add_track(&conn, 1, Some("The Devil's Blood"), Some("Die Old"));
        // The artist side, which is why nothing about this band linked.
        scrobbled(&conn, 10, "The Devil\u{2019}s Blood", "Die Old");
        resolve(&conn).unwrap();
        assert_eq!(
            linked(&conn, 10),
            None,
            "the old key holds the apostrophes apart"
        );

        assert!(refold_if_stale(&mut conn).unwrap().is_some());
        assert_eq!(
            keys(&conn, "plays"),
            [match_key("The Devil's Blood", "Die Old")]
        );
        assert_eq!(linked(&conn, 10), Some(1), "and the pass resolves itself");

        assert_eq!(refold_if_stale(&mut conn).unwrap(), None, "once per fold");
        assert_eq!(
            refold(&mut conn).unwrap(),
            Refolded {
                moved: 0,
                tracks: 0
            },
            "and it is idempotent"
        );
    }

    /// Issue 135 widened what `resolve` links through without touching a
    /// stored key, and nothing else resolves at launch.
    #[test]
    fn a_library_on_the_previous_fold_links_through_the_album_artist_once() {
        let (_dir, mut conn) = open();
        prometheus(&conn, 1);
        played(&conn, 10, "Prezident", "Prometheus");
        crate::db::settings::set(&conn, crate::db::settings::MATCH_FOLD, "2").unwrap();

        assert!(refold_if_stale(&mut conn).unwrap().is_some());
        assert_eq!(linked(&conn, 10), Some(1));
        assert_eq!(refold_if_stale(&mut conn).unwrap(), None, "once");
    }

    /// A collision on `idx_plays_identity` is one song scrobbled twice in the
    /// same second under two spellings. The index exists to drop the loser,
    /// and the pass has to finish rather than abort on it.
    #[test]
    fn a_collision_during_the_fold_drops_a_row_and_finishes() {
        let (_dir, mut conn) = open();
        scrobbled(&conn, 10, "The Devil\u{2019}s Blood", "Die Old");
        scrobbled(&conn, 10, "The Devil's Blood", "Die Old");
        scrobbled(&conn, 11, "King Dude", "Death Won\u{2019}t Take Me");

        refold(&mut conn).unwrap();

        assert_eq!(
            keys(&conn, "plays"),
            {
                let mut both = [
                    match_key("The Devil's Blood", "Die Old"),
                    match_key("King Dude", "Death Won't Take Me"),
                ];
                both.sort();
                both
            },
            "one row of the pair survives, and the pass got past it"
        );
    }

    /// `loved` is keyed by `match_key` and has no tags to recompute from, so
    /// the pass folds the stored key a side at a time - and `squeeze` would
    /// eat the separator if it were folded whole.
    #[test]
    fn a_loved_key_is_refolded_in_place() {
        let (_dir, mut conn) = open();
        conn.execute(
            "INSERT INTO loved (match_key, remote) VALUES (?1, 1)",
            [stale_key("The Devil\u{2019}s Blood", "Die Old")],
        )
        .unwrap();

        refold(&mut conn).unwrap();

        let folded = match_key("The Devil's Blood", "Die Old");
        assert!(folded.contains(SEPARATOR), "the separator survives");
        assert_eq!(keys(&conn, "loved"), std::slice::from_ref(&folded));
        let remote: bool = conn
            .query_row(
                "SELECT remote FROM loved WHERE match_key = ?1",
                [&folded],
                |row| row.get(0),
            )
            .unwrap();
        assert!(remote, "still the song last.fm reported");
        assert_eq!(refold(&mut conn).unwrap().moved, 0, "and it is idempotent");
    }

    /// Migration 18 adds `tracks.match_key` empty, and this pass is what fills
    /// it: the key is a Rust fold SQL cannot express.
    #[test]
    fn a_track_with_no_key_yet_is_given_one() {
        let (_dir, mut conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));
        add_track(&conn, 2, None, Some("Untitled"));

        assert_eq!(refold(&mut conn).unwrap().tracks, 1);

        let stored: Vec<Option<String>> = conn
            .prepare("SELECT match_key FROM tracks ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(stored, [Some(match_key("Blue Room", "Harbour")), None]);
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
