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
/// **Deliberately conservative**: case, punctuation, diacritics, script and
/// letters such as `ß` and `ø` folded through [`decompose`] and [`squeeze`],
/// `&` read as `and`, and a trailing remaster marker, `(feat. …)` or
/// `(with …)`, and a bare `feat. …` dropped.
/// Nothing else. Folding `(Live)` into the studio cut would destroy a
/// distinction the MBIDs exist to preserve, and a key that matched too much is
/// worse than one that matches nothing - it attributes plays to a song the
/// user never heard. A remaster is not that: it is the same recording.
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
pub(crate) fn fold_album(album: &str) -> String {
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

/// `value` lowercased, compatibility-decomposed, stripped of the combining
/// marks that decomposition exposed, and with the letters it leaves whole
/// [`spelled`] out.
///
/// NFKD rather than NFD because `…` is one codepoint that only compatibility
/// decomposition turns into `...`, which is the whole of the Marathonmann
/// group - three spellings and 184 plays.
fn decompose(value: &str) -> String {
    use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

    let mut decomposed = String::with_capacity(value.len());
    for character in value
        .to_lowercase()
        .nfkd()
        .filter(|character| !is_combining_mark(*character))
    {
        match spelled(character) {
            Some(spelling) => decomposed.push_str(spelling),
            None => decomposed.push(character),
        }
    }
    decomposed
}

/// A lowercase letter NFKD cannot take apart, in the Latin a tag without it
/// spells it with.
///
/// `ß` against `ss` is 187 unlinked plays over a real log, and it is a letter
/// rather than `s` and a mark, so decomposition leaves it alone - as it does
/// the rest of these. Not Unicode case folding, which spells out `ß` and none
/// of the others.
///
/// `ø` is `o` rather than `oe`: `o` links 22 spellings and `oe` 3. The runes
/// are the 24 of the Elder Futhark; the block's punctuation is not
/// alphanumeric, so [`squeeze`] already reads it as a word break.
fn spelled(character: char) -> Option<&'static str> {
    Some(match character {
        'ß' => "ss",
        'æ' => "ae",
        'œ' => "oe",
        'ø' => "o",
        'ð' | 'đ' => "d",
        'þ' => "th",
        'ł' => "l",
        'ᚠ' => "f",
        'ᚢ' => "u",
        'ᚦ' => "th",
        'ᚨ' => "a",
        'ᚱ' => "r",
        'ᚲ' => "k",
        'ᚷ' => "g",
        'ᚹ' => "w",
        'ᚺ' => "h",
        'ᚾ' => "n",
        'ᛁ' | 'ᛇ' => "i",
        'ᛃ' => "j",
        'ᛈ' => "p",
        'ᛉ' => "z",
        'ᛊ' => "s",
        'ᛏ' => "t",
        'ᛒ' => "b",
        'ᛖ' => "e",
        'ᛗ' => "m",
        'ᛚ' => "l",
        'ᛜ' => "ng",
        'ᛞ' => "d",
        'ᛟ' => "o",
        _ => return None,
    })
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
/// **The order is load-bearing in both directions.** [`without_remaster`],
/// [`without_featuring`] and [`without_bare_credit`] match lowercase, so they
/// run after [`decompose`]; and they match on delimiters, which [`squeeze`]
/// deletes, so they run before that. The marker goes first because a streaming
/// service appends it after the credit: `Song (feat. X) - Remastered`.
///
/// **A side that squeezes to nothing keeps its unsqueezed spelling.** `!!!`,
/// `†††` and the title `?` are alphanumeric-free, and an empty side empties
/// the whole key - which [`resolve`] skips. They link today and must go on
/// linking; `…` against `...` still folds, which is more than the key managed
/// before.
fn normalize(value: &str) -> String {
    let decomposed = decompose(value);
    let folded =
        without_bare_credit(without_featuring(without_remaster(decomposed.trim())).trim_end());
    // `&` is a word, and `squeeze` would delete it: `Gods & Monsters` is
    // tagged `Gods and Monsters`.
    match squeeze(&folded.replace('&', " and ")) {
        squeezed if squeezed.is_empty() => folded.into_owned(),
        squeezed => squeezed,
    }
}

/// Whether `word` belongs to a remaster marker: `Some(true)` for the word that
/// makes it one, `Some(false)` for a word that may only come along.
///
/// `version` is here as a companion only - `(2011 Version)` alone is a
/// different recording as often as not, and `(Live Version)` always is.
fn remaster_word(word: &str) -> Option<bool> {
    match word {
        "remaster" | "remastered" => Some(true),
        "digital" | "digitally" | "version" => Some(false),
        _ if word.len() == 4 && word.bytes().all(|byte| byte.is_ascii_digit()) => Some(false),
        _ => None,
    }
}

/// Whether `run` is a remaster marker and nothing else.
fn is_remaster(run: &str) -> bool {
    let mut remaster = false;
    for word in run
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
    {
        match remaster_word(word) {
            Some(named) => remaster |= named,
            None => return false,
        }
    }
    remaster
}

/// `value` without a trailing remaster marker: ` - <marker>`, `(<marker>)` or
/// `[<marker>]`.
///
/// A remaster is the same recording mastered again, which the album fold's
/// [`EDITIONS`] already holds. A marker with nothing before it is the title.
fn without_remaster(value: &str) -> &str {
    let trimmed = value.trim_end();
    let bracketed = match trimmed.chars().last() {
        Some(')') => trimmed.rfind('('),
        Some(']') => trimmed.rfind('['),
        _ => None,
    };
    let (before, run) = match bracketed {
        Some(open) => (&trimmed[..open], &trimmed[open + 1..trimmed.len() - 1]),
        None => match trimmed.rfind(" - ") {
            // A bracket in the suffix means the dash is inside a run, as in
            // `(Live - Remastered)`, and the run is what gets judged.
            Some(dash) if !trimmed[dash..].contains(['(', ')', '[', ']']) => {
                (&trimmed[..dash], &trimmed[dash + 3..])
            }
            _ => return value,
        },
    };
    let before = before.trim_end();
    if !before.is_empty() && is_remaster(run) {
        before
    } else {
        value
    }
}

/// A stored key's title side without the trailing words of a remaster marker.
///
/// [`squeeze`] has already deleted the delimiter [`without_remaster`] looks
/// for, so this can only go by the words, and takes every marker word at the
/// end but the first word of the title.
fn without_remaster_words(title: &str) -> &str {
    let mut rest = title;
    let mut remaster = false;
    while let Some((before, word)) = rest.rsplit_once(' ') {
        let Some(named) = remaster_word(word) else {
            break;
        };
        remaster |= named;
        rest = before;
    }
    if remaster {
        rest
    } else {
        title
    }
}

/// `value` without a trailing parenthesised credit.
///
/// The same song is tagged `Song`, `Song (feat. Guest)` and
/// `Song (with Guest)` across a library, and they are one song. Only at the
/// end, and only these openers - `(Live)` and `(Radio Edit)` name different
/// recordings and stay. Without the parentheses, [`without_bare_credit`]'s.
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

/// `value` without a credit outside brackets: the `Song feat. Guest` a
/// scrobbler writes for a tag's `Song (feat. Guest)`, and `Artist feat. Guest`
/// on the other side.
///
/// The credit runs to the next bracket or ` - `, and what follows stays: `Song
/// feat. Guest (Live)` is the live cut. Whole words, because `Creature Feature`
/// is a title, and neither `with` nor a bare `ft`, because `Dance with Me` and
/// `Left ft Right` are too. A bare `feat` stays in because a stored key has
/// already lost the period.
fn without_bare_credit(value: &str) -> std::borrow::Cow<'_, str> {
    use std::borrow::Cow;

    fn is_credit(rest: &str) -> bool {
        rest.starts_with("feat.")
            || rest.starts_with("ft.")
            || ["feat", "featuring"].iter().any(|word| {
                rest.strip_prefix(word)
                    .is_some_and(|after| after.is_empty() || after.starts_with(char::is_whitespace))
            })
    }

    let mut depth = 0_u32;
    let mut credit = None;
    for (index, character) in value.char_indices() {
        match character {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth == 0
                && character.is_whitespace()
                && is_credit(&value[index + character.len_utf8()..])
                && !value[..index].trim().is_empty() =>
            {
                credit = Some(index);
                break;
            }
            _ => {}
        }
    }
    let Some(start) = credit else {
        return Cow::Borrowed(value);
    };
    let before = value[..start].trim_end();
    let rest = &value[start..];
    match rest
        .find(['(', '['])
        .into_iter()
        .chain(rest.find(" - "))
        .min()
    {
        Some(tail) => Cow::Owned(format!("{before} {}", rest[tail..].trim_start())),
        None => Cow::Borrowed(before),
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
/// will compute for it unless the library holds the same song twice on one
/// album, or the album is blank, in which case the next rebuild moves the play
/// to whichever copy that function picks. `resolve` is
/// authoritative; this is what keeps the row linked until one runs, and
/// [`mark_unresolved`] is what makes the next scan run one.
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
    mark_unresolved(conn)?;

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
/// moved, and takes the plays that moved off the counts they left.
///
/// Runs at the end of both removals and a scan that changed something or finds
/// [`is_resolved`] false, for the reason [`crate::db::tag_values`] gives at
/// length; a tag write runs [`relink`]. The count is what the tests assert
/// idempotence with; no caller needs it.
pub fn resolve(conn: &Connection) -> AppResult<u32> {
    // One transaction rather than a commit per key, which is what the
    // temporary table's inserts cost where a scan or a removal calls this
    // bare (issue 166). A savepoint for `regroup`'s reason.
    conn.execute_batch("SAVEPOINT resolve")?;
    let resolved = resolve_within(conn, false).and_then(|moved| {
        crate::db::settings::set(conn, crate::db::settings::PLAYS_RESOLVED, "1")?;
        Ok(moved)
    });
    match resolved {
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

/// Whether every play still links where [`resolve`] last put it.
pub fn is_resolved(conn: &Connection) -> AppResult<bool> {
    Ok(crate::db::settings::get(conn, crate::db::settings::PLAYS_RESOLVED)?.is_some())
}

/// Notes a write that can move a link without running [`resolve`], so the
/// next scan runs it even if it changed nothing itself.
pub fn mark_unresolved(conn: &Connection) -> AppResult<()> {
    crate::db::settings::remove(conn, crate::db::settings::PLAYS_RESOLVED)
}

/// Raises each linked track's `play_count` and `last_played_at` to what its
/// plays say, never lowering either.
///
/// Runs after [`resolve`] at the end of an import and a scan, and inside
/// [`relink`] at the end of a tag write, so a file added or retagged after an
/// import shows the history it now links (issue 183). Not after a removal,
/// which hands counts on itself.
///
/// **`max`, because adding would count twice** every play from before
/// migration 13 that was also scrobbled: those are in `play_count` and come
/// back as `lastfm` rows. A local play since is one on each side, and the
/// import keeps its scrobble out. The cost is that a retag that takes a file
/// out of a song leaves that song's count on it. [`resolve`] lowers a count
/// only for plays that move to another track.
///
/// The guard is what keeps a second run from writing anything: every update
/// of `tracks` reindexes the row in `tracks_fts`.
pub fn count(conn: &Connection) -> AppResult<()> {
    count_within(conn, false)
}

/// [`count`], over every track or over the tracks a play in
/// `temp.scope_plays` links.
fn count_within(conn: &Connection, scoped: bool) -> AppResult<()> {
    let scope = if scoped {
        "AND track_id IN (SELECT track_id FROM plays
                           WHERE id IN (SELECT id FROM temp.scope_plays))"
    } else {
        ""
    };
    conn.execute(
        &format!(
            "UPDATE tracks
                SET play_count = max(play_count, n.plays),
                    last_played_at = max(coalesce(last_played_at, 0), n.last)
               FROM (SELECT track_id, count(*) AS plays, max(started_at) AS last
                       FROM plays
                      WHERE track_id IS NOT NULL {scope}
                      GROUP BY track_id) n
              WHERE n.track_id = tracks.id
                AND (n.plays > tracks.play_count
                     OR n.last > coalesce(tracks.last_played_at, 0))"
        ),
        [],
    )?;
    Ok(())
}

/// The tags [`resolve`] links a track through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkTags {
    pub artist: Option<String>,
    pub title: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
}

/// A track's [`LinkTags`], or none for a track that is not there.
pub fn link_tags(conn: &Connection, track_id: i64) -> AppResult<Option<LinkTags>> {
    Ok(conn
        .query_row(
            "SELECT artist, title, album, album_artist FROM tracks WHERE id = ?1",
            [track_id],
            |row| {
                Ok(LinkTags {
                    artist: row.get(0)?,
                    title: row.get(1)?,
                    album: row.get(2)?,
                    album_artist: row.get(3)?,
                })
            },
        )
        .optional()?)
}

/// [`resolve`] and [`count`] over only the plays a change to these tracks'
/// tags could move, given each one's [`LinkTags`] from before it, returning
/// how many links moved.
///
/// What a tag write runs: a full pass is a second over a real library, and
/// three files retagged move a handful of plays (issue 197). The plays left
/// out link where a full pass would put them as long as the log was resolved
/// before, so this leaves [`is_resolved`] as it found it.
pub fn relink(conn: &Connection, before: &[(i64, LinkTags)]) -> AppResult<u32> {
    let mut changed = Vec::new();
    for (track_id, tags) in before {
        let after = link_tags(conn, *track_id)?;
        if after.as_ref() != Some(tags) {
            changed.push(tags.clone());
            changed.extend(after);
        }
    }
    if changed.is_empty() {
        return Ok(0);
    }

    // A savepoint for `resolve`'s reason.
    conn.execute_batch("SAVEPOINT relink")?;
    let relinked = scope(conn, &changed).and_then(|()| {
        let moved = resolve_within(conn, true)?;
        count_within(conn, true)?;
        conn.execute_batch(
            "DROP TABLE temp.scope_plays;
             DROP TABLE temp.scope_tracks;",
        )?;
        Ok(moved)
    });
    match relinked {
        Ok(moved) => {
            conn.execute_batch("RELEASE relink")?;
            Ok(moved)
        }
        Err(error) => {
            conn.execute_batch("ROLLBACK TO relink; RELEASE relink")?;
            Err(error)
        }
    }
}

/// Fills `temp.scope_plays` with every play whose link can follow from these
/// tags, and `temp.scope_tracks` with every track [`resolve_within`] consults
/// to link them.
///
/// **A play's link depends on more than its key.** The key tiers read every
/// track under the play's key, artist's or album artist's. The album and
/// near-title tiers read every track on the play's folded album and judge the
/// play with the rest of its (artist, album) group, so a key that gains or
/// loses a track moves the plays it shares a group with, on an album the
/// write never named. So the plays are those under a key these tags make,
/// and every play on their albums or on the albums of the plays under those
/// keys; the tracks are those on the same albums and under any key those
/// plays carry.
///
/// Spellings rather than the stored keys: only the artist's key is a column,
/// and the full pass folds from the tags.
fn scope(conn: &Connection, changed: &[LinkTags]) -> AppResult<()> {
    use std::collections::HashSet;

    let mut keys: HashSet<String> = HashSet::new();
    let mut albums: HashSet<String> = HashSet::new();
    for tags in changed {
        let title = tags.title.as_deref().unwrap_or_default();
        for artist in [&tags.artist, &tags.album_artist] {
            let key = match_key(artist.as_deref().unwrap_or_default(), title);
            if !key.is_empty() {
                keys.insert(key);
            }
        }
        albums.insert(fold_album(tags.album.as_deref().unwrap_or_default()));
    }

    conn.execute_batch(
        "DROP TABLE IF EXISTS temp.scope_keys;
         CREATE TEMP TABLE scope_keys (key TEXT PRIMARY KEY) WITHOUT ROWID;
         DROP TABLE IF EXISTS temp.scope_spellings;
         CREATE TEMP TABLE scope_spellings (spelling TEXT PRIMARY KEY) WITHOUT ROWID;
         DROP TABLE IF EXISTS temp.scope_plays;
         CREATE TEMP TABLE scope_plays (id INTEGER PRIMARY KEY);
         DROP TABLE IF EXISTS temp.scope_tracks;
         CREATE TEMP TABLE scope_tracks (id INTEGER PRIMARY KEY);",
    )?;
    {
        let mut insert = conn.prepare("INSERT INTO temp.scope_keys (key) VALUES (?1)")?;
        for key in &keys {
            insert.execute([key])?;
        }
    }
    {
        let mut statement = conn.prepare(
            "SELECT DISTINCT album FROM plays
              WHERE match_key IN (SELECT key FROM temp.scope_keys)",
        )?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            albums.insert(fold_album(
                row.get::<_, Option<String>>(0)?
                    .as_deref()
                    .unwrap_or_default(),
            ));
        }
    }
    // Every blank album folds to the same nothing, and no tier reads one.
    albums.remove("");

    // Apart rather than one `UNION`, so the log's half reads `idx_plays_album`
    // instead of sorting a quarter of a million rows.
    let mut spellings: HashSet<String> = HashSet::new();
    let mut on_albums: Vec<String> = Vec::new();
    for sql in [
        "SELECT DISTINCT album FROM plays WHERE album <> ''",
        "SELECT DISTINCT album FROM tracks WHERE album <> ''",
    ] {
        let mut statement = conn.prepare(sql)?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let album: String = row.get(0)?;
            if !spellings.contains(&album) {
                if albums.contains(&fold_album(&album)) {
                    on_albums.push(album.clone());
                }
                spellings.insert(album);
            }
        }
    }
    {
        let mut insert = conn.prepare("INSERT INTO temp.scope_spellings (spelling) VALUES (?1)")?;
        for album in &on_albums {
            insert.execute([album])?;
        }
    }
    conn.execute_batch(
        "INSERT INTO temp.scope_plays (id)
         SELECT id FROM plays
          WHERE match_key IN (SELECT key FROM temp.scope_keys)
             OR album IN (SELECT spelling FROM temp.scope_spellings);
         INSERT INTO temp.scope_tracks (id)
         SELECT id FROM tracks WHERE album IN (SELECT spelling FROM temp.scope_spellings);
         DELETE FROM temp.scope_spellings;",
    )?;

    // A key's artist side is the artist or the album artist of every track
    // under it.
    let mut owners: HashSet<String> = HashSet::new();
    {
        let mut statement = conn.prepare(
            "SELECT DISTINCT match_key FROM plays
              WHERE id IN (SELECT id FROM temp.scope_plays) AND match_key <> ''",
        )?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let key: String = row.get(0)?;
            if let Some((artist, _)) = key.split_once(SEPARATOR) {
                owners.insert(artist.to_owned());
            }
        }
    }
    let mut credited: Vec<String> = Vec::new();
    {
        let mut statement = conn.prepare(
            "SELECT artist FROM tracks WHERE artist <> ''
             UNION SELECT album_artist FROM tracks WHERE album_artist <> ''",
        )?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let artist: String = row.get(0)?;
            if owners.contains(&normalize(&artist)) {
                credited.push(artist);
            }
        }
    }
    {
        let mut insert = conn.prepare("INSERT INTO temp.scope_spellings (spelling) VALUES (?1)")?;
        for artist in &credited {
            insert.execute([artist])?;
        }
    }
    conn.execute_batch(
        "INSERT OR IGNORE INTO temp.scope_tracks (id)
         SELECT id FROM tracks
          WHERE artist IN (SELECT spelling FROM temp.scope_spellings)
             OR album_artist IN (SELECT spelling FROM temp.scope_spellings);
         DROP TABLE temp.scope_keys;
         DROP TABLE temp.scope_spellings;",
    )?;
    Ok(())
}

/// [`resolve`]'s pass, over the whole log, or over `temp.scope_plays` linked
/// by `temp.scope_tracks` as [`scope`] fills them.
fn resolve_within(conn: &Connection, scoped: bool) -> AppResult<u32> {
    use std::collections::{HashMap, HashSet};

    let (tracks_in_scope, plays_in_scope) = if scoped {
        (
            "WHERE id IN (SELECT id FROM temp.scope_tracks)",
            "AND id IN (SELECT id FROM temp.scope_plays)",
        )
    } else {
        ("", "")
    };

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
         );
         DROP TABLE IF EXISTS temp.copy_keys;
         CREATE TEMP TABLE copy_keys (key TEXT PRIMARY KEY) WITHOUT ROWID;
         DROP TABLE IF EXISTS temp.copy_links;
         CREATE TEMP TABLE copy_links (
             play_id  INTEGER PRIMARY KEY,
             track_id INTEGER NOT NULL
         );
         DROP TABLE IF EXISTS temp.moved;
         CREATE TEMP TABLE moved (
             play_id INTEGER PRIMARY KEY,
             old     INTEGER,
             new     INTEGER
         );
         DROP TABLE IF EXISTS temp.losing;
         CREATE TEMP TABLE losing (
             id        INTEGER PRIMARY KEY,
             plays     INTEGER NOT NULL,
             last      INTEGER NOT NULL,
             kept      INTEGER NOT NULL,
             kept_last INTEGER
         );
         -- Only a play that leaves a track, so a first resolve, which links
         -- the whole log off NULL, fires it for none of them.
         DROP TRIGGER IF EXISTS temp.resolve_moved;
         CREATE TEMP TRIGGER resolve_moved AFTER UPDATE OF track_id ON plays
         WHEN old.track_id IS NOT NULL
         BEGIN
             INSERT INTO temp.moved (play_id, old, new)
             VALUES (old.id, old.track_id, new.track_id);
         END;",
    )?;

    // (album, title) to the track `play_keys`' tiebreak picks, and every
    // library artist a track under that pair names.
    let mut albums: HashMap<(String, String), (i64, HashSet<String>)> = HashMap::new();
    // (library artist, album) to each distinct title on it and the track the
    // tiebreak picks for that title, under both the artist and the album
    // artist.
    let mut shelves: HashMap<(String, String), Vec<(String, i64)>> = HashMap::new();
    // Each album spelling is folded once: a log repeats them by the thousand.
    let mut folds: HashMap<String, String> = HashMap::new();
    // Each key's tracks in tiebreak order with their folded albums: its
    // artist-key tracks, or its album-artist-key tracks when it has none.
    let mut copies: HashMap<String, Vec<(i64, String)>> = HashMap::new();
    {
        // **Which track wins a key is fixed rather than incidental.** The same
        // song on its album and on a compilation is two rows and one key, and
        // a library has hundreds of those. Present beats unplugged and the
        // older id beats the newer, which is migration 12's tiebreak for the
        // same reason it was chosen there: without one the winner follows scan
        // order, this function stops being idempotent, and the guarded UPDATE
        // below rewrites the whole table on every run.
        let mut tracks = conn.prepare(&format!(
            "SELECT id, artist, title, album_artist, album FROM tracks {tracks_in_scope}
              ORDER BY missing_since IS NOT NULL, id"
        ))?;
        let mut insert =
            conn.prepare("INSERT OR IGNORE INTO temp.play_keys (key, track_id) VALUES (?1, ?2)")?;

        // **The album artist is a fallback, inserted after every artist key.**
        // last.fm credits the primary artist and moves a guest into the title,
        // so `Prezident mit Absztrakkt` on the file is `Prezident` in the log,
        // and the album artist is the one field that says so. Going second
        // lets an artist key win any key both produce, so no link that is
        // right today moves (issue 135).
        let mut fallbacks: Vec<(String, i64, String)> = Vec::new();
        let mut rows = tracks.query([])?;
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let artist: Option<String> = row.get(1)?;
            let title: Option<String> = row.get(2)?;
            let album_artist: Option<String> = row.get(3)?;
            let album: String = row.get::<_, Option<String>>(4)?.unwrap_or_default();
            let album = folds
                .entry(album)
                .or_insert_with_key(|album| fold_album(album))
                .clone();
            let artist = artist.as_deref().unwrap_or_default();
            let album_artist = album_artist.as_deref().unwrap_or_default();
            let title = title.as_deref().unwrap_or_default();
            let key = match_key(artist, title);
            if !key.is_empty() {
                insert.execute(rusqlite::params![key, id])?;
                copies
                    .entry(key.clone())
                    .or_default()
                    .push((id, album.clone()));
            }
            let fallback = match_key(album_artist, title);
            if !fallback.is_empty() && fallback != key {
                fallbacks.push((fallback, id, album.clone()));
            }

            let artist = normalize(artist);
            let album_artist = normalize(album_artist);
            let title = normalize(title);
            if album.is_empty() || title.is_empty() {
                continue;
            }
            let owners =
                std::iter::once(&artist).chain((album_artist != artist).then_some(&album_artist));
            for owner in owners.filter(|owner| !owner.is_empty()) {
                let shelf = shelves.entry((owner.clone(), album.clone())).or_default();
                if !shelf.iter().any(|(held, _)| held == &title) {
                    shelf.push((title.clone(), id));
                }
            }
            let owner = if album_artist.is_empty() {
                artist
            } else {
                album_artist
            };
            if !owner.is_empty() {
                albums
                    .entry((album, title))
                    .or_insert_with(|| (id, HashSet::new()))
                    .1
                    .insert(owner);
            }
        }
        let mut by_album_artist: HashMap<String, Vec<(i64, String)>> = HashMap::new();
        for (key, id, album) in fallbacks {
            insert.execute(rusqlite::params![key, id])?;
            if !copies.contains_key(&key) {
                by_album_artist.entry(key).or_default().push((id, album));
            }
        }
        copies.extend(by_album_artist);
    }

    // A key whose later copies sit on no album its winner does needs no
    // album to choose.
    copies.retain(|_, held| {
        let first = &held[0].1;
        held[1..]
            .iter()
            .any(|(_, album)| !album.is_empty() && album != first)
    });
    {
        let mut insert = conn.prepare("INSERT INTO temp.copy_keys (key) VALUES (?1)")?;
        for key in copies.keys() {
            insert.execute([key])?;
        }
    }

    // One read of the log for two tiers, which want disjoint plays: the copy
    // tier those whose key names several copies, the album tier those whose
    // key names nothing.
    {
        type Hit<'a> = (i64, String, i64, &'a HashSet<String>);
        let mut groups: HashMap<(String, String), Vec<Hit>> = HashMap::new();
        let mut copy_links: Vec<(i64, i64)> = Vec::new();
        let mut plays = conn.prepare(&format!(
            "SELECT id, artist, title, album, match_key FROM plays
              WHERE match_key <> '' AND album <> '' {plays_in_scope}
                AND (match_key NOT IN (SELECT key FROM temp.play_keys)
                     OR match_key IN (SELECT key FROM temp.copy_keys))"
        ))?;
        let mut rows = plays.query([])?;
        while let Some(row) = rows.next()? {
            let album = folds
                .entry(row.get(3)?)
                .or_insert_with_key(|album| fold_album(album))
                .clone();

            // **A song on several albums links each play to the copy on the
            // album it was heard on**, and only then to the key's winner:
            // `Cleansing` on *Two Hunters* and on *Live at Roadburn 2008* is
            // one key, and the older live copy took every play of the studio
            // one (issue 195). A play whose album is blank or matches no copy
            // keeps the winner. The order is the tiebreak's, so two copies on
            // one album still go present, then older.
            if let Some(held) = copies.get(&row.get::<_, String>(4)?) {
                let copy = held
                    .iter()
                    .find(|(_, on)| !album.is_empty() && *on == album);
                if let Some(&(track_id, _)) = copy.filter(|(id, _)| *id != held[0].0) {
                    copy_links.push((row.get(0)?, track_id));
                }
                continue;
            }

            // **The album on the play is the last resort, and it has to be
            // corroborated.** last.fm merges some artists into others - `Disko
            // Degenhardt` scrobbles as `Franz Josef Degenhardt` - so no key the
            // play carries names the file. Two titles of one scrobbled album
            // landing on one library artist's copy of it is the evidence; one
            // title alone links a cover or a title track to a song that was
            // never heard (issue 145).
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
            conn.prepare("INSERT INTO temp.copy_links (play_id, track_id) VALUES (?1, ?2)")?;
        for (play_id, track_id) in &copy_links {
            link.execute([play_id, track_id])?;
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

    // **A near title is the last resort after the album, on the artist's own
    // copy of it.** `Dia Artio` is `Dea Artio` and `Terraplane` is
    // `Terraplane '99`, and no fold can say so without folding different
    // songs together. The album narrows the field to a dozen titles, and
    // [`nearest`] links only one that stands out from the rest (issue 173).
    {
        let mut plays = conn.prepare(&format!(
            "SELECT id, artist, title, album FROM plays
              WHERE match_key <> '' AND album <> '' {plays_in_scope}
                AND match_key NOT IN (SELECT key FROM temp.play_keys)
                AND id NOT IN (SELECT play_id FROM temp.album_links)"
        ))?;
        let mut spellings: HashMap<(String, String, String), Option<i64>> = HashMap::new();
        // Read to the end before writing, since the query reads the table
        // the links go into.
        let mut links: Vec<(i64, i64)> = Vec::new();
        let mut rows = plays.query([])?;
        while let Some(row) = rows.next()? {
            let spelling: (String, String, String) = (row.get(1)?, row.get(2)?, row.get(3)?);
            let track_id = match spellings.get(&spelling) {
                Some(track_id) => *track_id,
                None => {
                    let album = folds
                        .entry(spelling.2.clone())
                        .or_insert_with_key(|album| fold_album(album));
                    let track_id = shelves
                        .get(&(normalize(&spelling.0), album.clone()))
                        .and_then(|shelf| nearest(&normalize(&spelling.1), shelf));
                    spellings.insert(spelling, track_id);
                    track_id
                }
            };
            if let Some(track_id) = track_id {
                links.push((row.get(0)?, track_id));
            }
        }

        let mut link =
            conn.prepare("INSERT INTO temp.album_links (play_id, track_id) VALUES (?1, ?2)")?;
        for (play_id, track_id) in &links {
            link.execute([play_id, track_id])?;
        }
    }

    // **The guard is what makes the full scan affordable.** After a scan that
    // retagged three files the statement still reads every play, but it writes
    // only the handful whose link actually moved, instead of rewriting a
    // quarter of a million rows to the values they already held.
    //
    // `IS NOT` rather than `<>` because most of those values are NULL on both
    // sides, and `<>` is NULL there rather than false.
    //
    // One assignment for every tier: a second `UPDATE` for the album links
    // would find each of them nulled by this one and write it back, every run.
    let moved = conn.execute(
        &format!(
            "UPDATE plays
                SET track_id = coalesce(
                    (SELECT c.track_id FROM temp.copy_links c WHERE c.play_id = plays.id),
                    (SELECT k.track_id FROM temp.play_keys k WHERE k.key = plays.match_key),
                    (SELECT a.track_id FROM temp.album_links a WHERE a.play_id = plays.id))
              WHERE match_key <> '' {plays_in_scope}
                AND track_id IS NOT coalesce(
                    (SELECT c.track_id FROM temp.copy_links c WHERE c.play_id = plays.id),
                    (SELECT k.track_id FROM temp.play_keys k WHERE k.key = plays.match_key),
                    (SELECT a.track_id FROM temp.album_links a WHERE a.play_id = plays.id))"
        ),
        [],
    )?;

    // **A track that loses plays to another track gives up their count**, or
    // both copies count them: `count` only raises (issue 195). Only where the
    // count and the last play are its links' own - a count above them holds
    // local history from before migration 13. A play that now links nowhere
    // stays counted, so a retag that takes a file out of a song keeps the
    // song's count on it, as `count` documents.
    //
    // `moved` holds what the trigger saw: plays that left a track. A play that
    // arrived from nowhere is not in it, so a track that also gained one reads
    // as having held more than its count and keeps it.
    conn.execute_batch(
        "INSERT INTO temp.losing (id, plays, last, kept, kept_last)
         SELECT t,
                (SELECT count(*) FROM plays WHERE track_id = t)
                  + (SELECT count(*) FROM temp.moved WHERE old = t)
                  - (SELECT count(*) FROM temp.moved WHERE new = t),
                max(coalesce((SELECT max(started_at) FROM plays
                               WHERE track_id = t
                                 AND id NOT IN (SELECT play_id FROM temp.moved WHERE new = t)), 0),
                    (SELECT max(p.started_at) FROM temp.moved m JOIN plays p ON p.id = m.play_id
                      WHERE m.old = t)),
                (SELECT count(*) FROM plays WHERE track_id = t)
                  + (SELECT count(*) FROM temp.moved WHERE old = t AND new IS NULL),
                nullif(max(coalesce((SELECT max(started_at) FROM plays WHERE track_id = t), 0),
                           coalesce((SELECT max(p.started_at) FROM temp.moved m
                                       JOIN plays p ON p.id = m.play_id
                                      WHERE m.old = t AND m.new IS NULL), 0)), 0)
           FROM (SELECT DISTINCT old AS t FROM temp.moved WHERE new IS NOT NULL);

         UPDATE tracks
            SET play_count = CASE WHEN play_count = l.plays THEN l.kept ELSE play_count END,
                last_played_at = CASE WHEN last_played_at = l.last
                                      THEN l.kept_last ELSE last_played_at END
           FROM temp.losing l
          WHERE tracks.id = l.id
            AND ((play_count = l.plays AND play_count <> l.kept)
                 OR (last_played_at = l.last AND last_played_at IS NOT l.kept_last));

         DROP TRIGGER temp.resolve_moved;
         DROP TABLE temp.play_keys;
         DROP TABLE temp.album_links;
         DROP TABLE temp.copy_keys;
         DROP TABLE temp.copy_links;
         DROP TABLE temp.moved;
         DROP TABLE temp.losing;",
    )?;
    Ok(moved as u32)
}

/// How near a title has to be to link, and how far ahead of the next title on
/// its album, as [`similarity`] measures them.
const NEAR: f64 = 0.85;
const MARGIN: f64 = 0.1;

/// The words that make a longer title another recording or another piece:
/// `Unsachlich (Skit)`, `My Everlasting Life II`.
const VERSIONS: &[&str] = &[
    "live",
    "remix",
    "mix",
    "skit",
    "orchestral",
    "acoustic",
    "demo",
    "instrumental",
    "edit",
    "version",
    "intro",
    "outro",
    "reprise",
    "interlude",
    "unplugged",
    "radio",
    "extended",
    "dub",
    "part",
    "pt",
    "2",
    "3",
    "4",
    "5",
    "ii",
    "iii",
    "iv",
    "v",
];

/// The track on `shelf` whose title is near `title`, when exactly one is.
///
/// Near enough is [`NEAR`], and the runner-up has to trail by [`MARGIN`], so
/// that of `Part 1` and `Part 2` neither is picked. A title that is the
/// other plus a word from [`VERSIONS`] never links, however near: a skit or a
/// sequel is a different track that reads as a spelling.
fn nearest(title: &str, shelf: &[(String, i64)]) -> Option<i64> {
    let mut best: Option<(f64, &str, i64)> = None;
    let mut second = 0.0_f64;
    for (candidate, track_id) in shelf {
        let score = similarity(title, candidate);
        match best {
            Some((leader, ..)) if score <= leader => second = second.max(score),
            _ => {
                if let Some((leader, ..)) = best {
                    second = second.max(leader);
                }
                best = Some((score, candidate, *track_id));
            }
        }
    }
    let (score, candidate, track_id) = best?;
    (score >= NEAR && score - second >= MARGIN && !adds_a_version(title, candidate))
        .then_some(track_id)
}

/// The share of both titles' characters their longest common subsequence
/// covers, from 0 to 1.
///
/// Both lengths rather than the longer one, which is Python's `difflib` ratio
/// the thresholds were first measured with: `Terraplane` against `Terraplane
/// 99` is three insertions, 0.77 of the longer title and 0.87 of the two.
fn similarity(a: &str, b: &str) -> f64 {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut row = vec![0_u32; b.len() + 1];
    for left in &a {
        let mut diagonal = 0;
        for (index, right) in b.iter().enumerate() {
            let above = row[index + 1];
            row[index + 1] = if left == right {
                diagonal + 1
            } else {
                above.max(row[index])
            };
            diagonal = above;
        }
    }
    2.0 * f64::from(row[b.len()]) / (a.len() + b.len()) as f64
}

/// Whether one title is the other with words added, and one of them is in
/// [`VERSIONS`].
fn adds_a_version(a: &str, b: &str) -> bool {
    let a: Vec<&str> = a.split(' ').collect();
    let b: Vec<&str> = b.split(' ').collect();
    let (shorter, longer) = if a.len() < b.len() { (a, b) } else { (b, a) };
    if shorter.len() == longer.len() {
        return false;
    }
    let mut kept = shorter.iter().peekable();
    let mut added = Vec::new();
    for word in &longer {
        if kept.peek() == Some(&word) {
            kept.next();
        } else {
            added.push(*word);
        }
    }
    kept.peek().is_none() && added.iter().any(|word| VERSIONS.contains(word))
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
const FOLD_VERSION: &str = "2";

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
/// gives a track another key, as 3 did for the album artist, 4 for the album,
/// 8 for a near title and 9 for the copy on the play's album: the stored keys
/// stay put, but nothing else resolves at launch.
const MATCH_FOLD_VERSION: &str = "9";

/// Rewrites every stored `match_key` with the current fold, returning how many
/// rows moved.
///
/// `plays` and `tracks` recompute from their own `artist` and `title`. `loved`
/// has neither column, so it folds the stored key in place, a side at a time:
/// the new fold refines the old one, so folding an old key again lands where
/// folding the original tags would - but [`squeeze`] eats [`SEPARATOR`], so
/// the key cannot be folded whole. The exception is the remaster marker, whose
/// delimiter the old key has lost; [`without_remaster_words`] goes by its words
/// instead.
///
/// **A loved key that was a track's follows the track.** The old key has lost
/// the `&` the fold now reads as `and`, and the period of `ft.`, so folding it
/// again cannot land where the track's tags do. A key two tracks shared and
/// the new fold parts is loved under both.
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
    use std::collections::{BTreeSet, HashMap};

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
    let mut carried: HashMap<String, BTreeSet<String>> = HashMap::new();
    {
        let mut statement = tx.prepare("SELECT id, artist, title, match_key FROM tracks")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let folded = track_key(
                row.get::<_, Option<String>>(1)?.as_deref(),
                row.get::<_, Option<String>>(2)?.as_deref(),
            );
            let stored = row.get::<_, Option<String>>(3)?;
            // Every track rather than the ones that move, so a key shared with
            // a track whose key stays keeps its love there too.
            if let (Some(stored), Some(folded)) = (&stored, &folded) {
                carried
                    .entry(stored.clone())
                    .or_default()
                    .insert(folded.clone());
            }
            if folded != stored {
                retagged.push((row.get(0)?, folded));
            }
        }
    }

    let mut refolded: Vec<(String, BTreeSet<String>)> = Vec::new();
    {
        let mut statement = tx.prepare("SELECT match_key FROM loved")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let stored: String = row.get(0)?;
            let folded = match carried.remove(&stored) {
                Some(folded) => folded,
                None => {
                    let Some((artist, title)) = stored.split_once(SEPARATOR) else {
                        continue;
                    };
                    let folded = match_key(artist, without_remaster_words(title));
                    if folded.is_empty() {
                        continue;
                    }
                    BTreeSet::from([folded])
                }
            };
            if folded.len() > 1 || !folded.contains(&stored) {
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
            for key in folded {
                insert.execute([key, stored])?;
            }
            if !folded.contains(stored) {
                delete.execute([stored])?;
            }
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
/// **It runs [`resolve`] and [`count`] itself.** Nothing else resolves at
/// launch - the callers are the scan, the import and a tag write - so a pass
/// that stopped at the keys would leave every newly foldable play unlinked
/// until the user next scanned or imported, and the scan after it skips both
/// (issue 193). Before the marker, so a failure in either is retried on the
/// next launch.
pub fn refold_if_stale(conn: &mut Connection) -> AppResult<Option<Refolded>> {
    use crate::db::settings;

    if settings::get(conn, settings::MATCH_FOLD)?.as_deref() == Some(MATCH_FOLD_VERSION) {
        return Ok(None);
    }
    let refolded = refold(conn)?;
    resolve(conn)?;
    count(conn)?;
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

        // The separator is doing its job.
        assert_ne!(match_key("ab", "c"), match_key("a", "bc"));
    }

    /// A remaster is the recording mastered again, and streaming services
    /// append it to the title (issue 171).
    #[test]
    fn a_remaster_marker_is_the_same_recording() {
        let song = match_key("Rome", "L'Assassin");
        for spelling in [
            "L'assassin - Remastered",
            "L'Assassin - Remastered 2016",
            "L'Assassin - 2011 Remastered Version",
            "L'Assassin - Digitally Remastered",
            "L'Assassin (2016 - Remaster)",
            "L'Assassin [Remastered]",
            "L'Assassin (feat. Guest) - Remastered",
        ] {
            assert_eq!(match_key("Rome", spelling), song, "{spelling}");
        }

        for spelling in [
            "L'Assassin (remastered out-take)",
            "L'Assassin (premaster)",
            "L'Assassin (Live)",
            "L'Assassin - Live",
            "L'Assassin (2011 Version)",
            // The dash is inside the run, so the run is what gets judged.
            "L'Assassin (Live - Remastered)",
        ] {
            assert_ne!(match_key("Rome", spelling), song, "{spelling}");
        }

        // A marker with nothing before it is the title.
        assert_eq!(
            match_key("Rome", "(Remastered)"),
            format!("rome{SEPARATOR}remastered")
        );
    }

    /// `&` is a word `squeeze` would delete, and a scrobbler writes the credit
    /// a tag brackets without the brackets (issue 172).
    #[test]
    fn an_ampersand_and_a_bare_credit_are_the_same_song() {
        assert_eq!(
            match_key("Lana Del Rey", "Gods & Monsters"),
            match_key("Lana Del Rey", "Gods and Monsters")
        );
        assert_eq!(
            match_key("Simon & Garfunkel", "The Boxer"),
            match_key("Simon and Garfunkel", "The Boxer")
        );

        let song = match_key("Casper", "In deinen Armen");
        for (artist, title) in [
            ("Casper", "In deinen Armen feat. Amaris"),
            ("Casper feat. Amaris", "In deinen Armen"),
            ("Casper", "In deinen Armen Feat Amaris"),
            ("Casper", "In deinen Armen featuring Amaris"),
            ("Casper", "In deinen Armen ft. Amaris"),
            ("Casper ft. Amaris & Guest", "In deinen Armen"),
            ("Casper", "In deinen Armen feat. Amaris - Remastered"),
        ] {
            assert_eq!(match_key(artist, title), song, "{artist:?} - {title:?}");
        }

        // What follows the credit names the recording, and stays.
        for version in [" (Live)", " [Live]", " - Live"] {
            assert_eq!(
                match_key("Casper", &format!("In deinen Armen feat. Amaris{version}")),
                match_key("Casper", &format!("In deinen Armen{version}")),
                "{version:?}"
            );
        }
        assert_ne!(
            match_key("Casper", "In deinen Armen feat. Amaris (Live)"),
            song
        );

        // Words that only look like a credit, and a credit in a run that
        // `without_featuring` does not own.
        for title in [
            "Dance with Me",
            "Left ft Right",
            "Creature Feature",
            "Feathers and Wax",
            "Feat. of Clay",
            "Harbour (Live feat. Guest)",
        ] {
            assert_eq!(
                match_key("Blue Room", title),
                format!("blue room{SEPARATOR}{}", squeeze(&decompose(title))),
                "{title:?}"
            );
        }
    }

    /// Letters in their own right rather than a base letter and a mark, so
    /// NFKD has nothing to strip from them (issue 170).
    #[test]
    fn a_letter_decomposition_leaves_whole_folds_to_its_spelling() {
        let cases = [
            (
                ("Von Thronstahl", "Ganz in Weiß und ganz in Eisen"),
                ("Von Thronstahl", "Ganz In Weiss Und Ganz In Eisen"),
            ),
            (("Burzum", "Heiðr"), ("Burzum", "Heidr")),
            (("Borknagar", "Æra"), ("Borknagar", "Aera")),
            (("Troll", "Mørkets Skoger"), ("Troll", "Morkets Skoger")),
            (("Windir", "LIKBØR"), ("Windir", "Likbor")),
            (("Sólstafir", "Þín Orð"), ("Solstafir", "Thin Ord")),
            (
                ("Mgła", "Exercises in Futility"),
                ("Mgla", "Exercises in Futility"),
            ),
            (
                ("The Ruins of Beverast", "ᚨᛚᚢ"),
                ("The Ruins of Beverast", "Alu"),
            ),
            // Rune punctuation is a word break, the way `squeeze` treats a
            // space.
            (
                ("Wardruna", "ᚦᚢᚱᛁᛊᚨᛉ᛫ᛞᚨᚷᚨᛉ"),
                ("Wardruna", "Thurisaz Dagaz"),
            ),
        ];
        for (left, right) in cases {
            assert_eq!(
                match_key(left.0, left.1),
                match_key(right.0, right.1),
                "{left:?} and {right:?} are one song"
            );
        }
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
            // A letter NFKD leaves whole, which the fold spells out itself.
            (
                ("Rammstein", "Große Freiheit"),
                ("Rammstein", "Grosse Freiheit"),
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

    /// The live copy is the older id, so the key's tiebreak picks it.
    fn two_hunters(conn: &Connection) {
        on_album(
            conn,
            1,
            "Wolves in the Throne Room",
            "Live at Roadburn 2008",
            "Cleansing",
        );
        on_album(
            conn,
            2,
            "Wolves in the Throne Room",
            "Two Hunters",
            "Cleansing",
        );
    }

    fn cleansing(conn: &Connection, started_at: i64, album: &str) {
        played_on(
            conn,
            started_at,
            "Wolves in the Throne Room",
            album,
            "Cleansing",
        );
    }

    fn counted(conn: &Connection, id: i64) -> (i64, Option<i64>) {
        conn.query_row(
            "SELECT play_count, last_played_at FROM tracks WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    #[test]
    fn a_play_links_to_the_copy_on_its_album() {
        let (_dir, conn) = open();
        two_hunters(&conn);
        cleansing(&conn, 10, "Two Hunters");
        cleansing(&conn, 11, "Live at Roadburn 2008");
        cleansing(&conn, 12, "Two Hunters (Deluxe Edition)");

        resolve(&conn).unwrap();
        assert_eq!(
            [linked(&conn, 10), linked(&conn, 11), linked(&conn, 12)],
            [Some(2), Some(1), Some(2)]
        );
        assert_eq!(resolve(&conn).unwrap(), 0, "a second pass moves nothing");
    }

    #[test]
    fn a_play_on_no_copys_album_links_to_the_tiebreak() {
        let (_dir, conn) = open();
        two_hunters(&conn);
        cleansing(&conn, 10, "Two Hunters - Vinyl");
        played(&conn, 11, "Wolves in the Throne Room", "Cleansing");

        resolve(&conn).unwrap();
        assert_eq!([linked(&conn, 10), linked(&conn, 11)], [Some(1), Some(1)]);
    }

    #[test]
    fn two_copies_on_the_plays_album_go_to_the_tiebreak() {
        let (_dir, conn) = open();
        two_hunters(&conn);
        on_album(
            &conn,
            3,
            "Wolves in the Throne Room",
            "Two Hunters",
            "Cleansing",
        );
        cleansing(&conn, 10, "Two Hunters");

        resolve(&conn).unwrap();
        assert_eq!(linked(&conn, 10), Some(2), "the older id");

        conn.execute("UPDATE tracks SET missing_since = 1 WHERE id = 2", [])
            .unwrap();
        resolve(&conn).unwrap();
        assert_eq!(linked(&conn, 10), Some(3), "the present file");
    }

    /// Track 1 is the play's key only through its album artist, so it is no
    /// copy while an artist key names another track.
    #[test]
    fn an_album_artist_copy_on_the_plays_album_does_not_take_it() {
        let (_dir, conn) = open();
        prometheus(&conn, 1);
        conn.execute("UPDATE tracks SET album = 'Kenning' WHERE id = 1", [])
            .unwrap();
        on_album(&conn, 2, "Prezident", "Limbus", "Prometheus");
        played_on(&conn, 10, "Prezident", "Kenning", "Prometheus");

        resolve(&conn).unwrap();
        assert_eq!(linked(&conn, 10), Some(2));
    }

    #[test]
    fn album_artist_copies_link_by_album_when_no_artist_key_does() {
        let (_dir, conn) = open();
        prometheus(&conn, 1);
        prometheus(&conn, 2);
        conn.execute_batch(
            "UPDATE tracks SET album = 'Limbus' WHERE id = 1;
             UPDATE tracks SET album = 'Kenning' WHERE id = 2;",
        )
        .unwrap();
        played_on(&conn, 10, "Prezident", "Kenning", "Prometheus");

        resolve(&conn).unwrap();
        assert_eq!(linked(&conn, 10), Some(2));
    }

    #[test]
    fn a_copy_that_loses_plays_to_another_gives_up_their_count() {
        let (_dir, conn) = open();
        two_hunters(&conn);
        cleansing(&conn, 10, "Two Hunters");
        cleansing(&conn, 11, "Two Hunters");
        cleansing(&conn, 12, "Two Hunters - Vinyl");
        // What `count` left after a resolve that sent every play to the live
        // copy.
        conn.execute_batch(
            "UPDATE plays SET track_id = 1;
             UPDATE tracks SET play_count = 3, last_played_at = 12 WHERE id = 1;",
        )
        .unwrap();

        resolve(&conn).unwrap();
        count(&conn).unwrap();
        assert_eq!(counted(&conn, 1), (1, Some(12)));
        assert_eq!(counted(&conn, 2), (2, Some(11)));

        conn.execute("DELETE FROM plays WHERE started_at = 12", [])
            .unwrap();
        conn.execute("UPDATE plays SET track_id = 1", []).unwrap();
        conn.execute(
            "UPDATE tracks SET play_count = 2, last_played_at = 11 WHERE id = 1",
            [],
        )
        .unwrap();
        resolve(&conn).unwrap();
        assert_eq!(counted(&conn, 1), (0, None), "nothing left linked");
    }

    #[test]
    fn a_count_above_its_links_keeps_what_it_held() {
        let (_dir, conn) = open();
        two_hunters(&conn);
        cleansing(&conn, 10, "Two Hunters");
        cleansing(&conn, 11, "Live at Roadburn 2008");
        conn.execute_batch(
            "UPDATE plays SET track_id = 1;
             UPDATE tracks SET play_count = 40, last_played_at = 900 WHERE id = 1;",
        )
        .unwrap();

        resolve(&conn).unwrap();
        assert_eq!(counted(&conn, 1), (40, Some(900)));
    }

    #[test]
    fn a_retag_that_unlinks_plays_keeps_their_count() {
        let (_dir, conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));
        played(&conn, 10, "Blue Room", "Harbour");
        resolve(&conn).unwrap();
        count(&conn).unwrap();

        conn.execute("UPDATE tracks SET title = 'Harbor' WHERE id = 1", [])
            .unwrap();
        resolve(&conn).unwrap();

        assert_eq!(linked(&conn, 10), None);
        assert_eq!(counted(&conn, 1), (1, Some(10)));
    }

    #[test]
    fn a_library_on_the_previous_fold_links_by_album_and_counts_once() {
        let (_dir, mut conn) = open();
        two_hunters(&conn);
        cleansing(&conn, 10, "Two Hunters");
        cleansing(&conn, 11, "Two Hunters");
        resolve(&conn).unwrap();
        conn.execute_batch(
            "UPDATE plays SET track_id = 1;
             UPDATE tracks SET play_count = 2, last_played_at = 11 WHERE id = 1;
             UPDATE tracks SET play_count = 5, last_played_at = 3 WHERE id = 2;",
        )
        .unwrap();
        crate::db::settings::set(&conn, crate::db::settings::MATCH_FOLD, "8").unwrap();

        assert!(refold_if_stale(&mut conn).unwrap().is_some());
        assert_eq!([linked(&conn, 10), linked(&conn, 11)], [Some(2), Some(2)]);
        assert_eq!(counted(&conn, 1), (0, None));
        assert_eq!(counted(&conn, 2), (5, Some(11)), "and counts");
        assert_eq!(refold_if_stale(&mut conn).unwrap(), None, "once");
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

    fn industrial_silence(conn: &Connection) {
        on_album(conn, 1, "Madrugada", "Industrial Silence", "Terraplane '99");
        on_album(conn, 2, "Madrugada", "Industrial Silence", "Vocal");
    }

    /// A near title on the artist's own album is the same song under another
    /// spelling (issue 173).
    #[test]
    fn a_near_title_on_its_album_links() {
        let (_dir, conn) = open();
        industrial_silence(&conn);
        // A second copy of the album, which is not a rival title.
        on_album(
            &conn,
            3,
            "Madrugada",
            "Industrial Silence",
            "Terraplane '99",
        );
        on_album(
            &conn,
            4,
            "Wolves in the Throne Room",
            "Two Hunters",
            "Dea Artio",
        );
        on_album(
            &conn,
            5,
            "Wolves in the Throne Room",
            "Two Hunters",
            "Cleansing",
        );
        played_on(&conn, 10, "Madrugada", "Industrial Silence", "Terraplane");
        played_on(
            &conn,
            11,
            "Wolves in the Throne Room",
            "Two Hunters",
            "Dia Artio",
        );

        resolve(&conn).unwrap();
        assert_eq!([linked(&conn, 10), linked(&conn, 11)], [Some(1), Some(4)]);
        assert_eq!(resolve(&conn).unwrap(), 0, "a second pass moves nothing");
    }

    /// An unplugged drive keeps the link, as it does for a key.
    #[test]
    fn a_near_title_on_a_missing_track_links() {
        let (_dir, conn) = open();
        industrial_silence(&conn);
        conn.execute("UPDATE tracks SET missing_since = 1 WHERE id = 1", [])
            .unwrap();
        played_on(&conn, 10, "Madrugada", "Industrial Silence", "Terraplane");

        resolve(&conn).unwrap();
        assert_eq!(linked(&conn, 10), Some(1));
    }

    #[test]
    fn a_near_title_that_adds_a_version_stays_unlinked() {
        let (_dir, conn) = open();
        on_album(
            &conn,
            1,
            "King Dude",
            "Tonight's Special Death",
            "My Everlasting Life II",
        );
        on_album(
            &conn,
            2,
            "Absztrakkt",
            "Diamantgeiszt",
            "Back in the daysz (Skit)",
        );
        played_on(
            &conn,
            10,
            "King Dude",
            "Tonight's Special Death",
            "My Everlasting Life",
        );
        played_on(
            &conn,
            11,
            "Absztrakkt",
            "Diamantgeiszt",
            "Back in the daysz",
        );

        resolve(&conn).unwrap();
        assert_eq!([linked(&conn, 10), linked(&conn, 11)], [None, None]);
    }

    #[test]
    fn a_near_title_with_a_close_runner_up_stays_unlinked() {
        let (_dir, conn) = open();
        on_album(&conn, 1, "Blue Room", "Harbour", "Harbour Lights");
        on_album(&conn, 2, "Blue Room", "Harbour", "Harbor Light");
        played_on(&conn, 10, "Blue Room", "Harbour", "Harbour Light");

        resolve(&conn).unwrap();
        assert_eq!(linked(&conn, 10), None);
    }

    #[test]
    fn a_near_title_on_another_album_stays_unlinked() {
        let (_dir, conn) = open();
        on_album(&conn, 1, "Madrugada", "The Deep End", "Terraplane '99");
        on_album(&conn, 2, "Madrugada", "Industrial Silence", "Vocal");
        played_on(&conn, 10, "Madrugada", "Industrial Silence", "Terraplane");

        resolve(&conn).unwrap();
        assert_eq!(linked(&conn, 10), None);
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

    /// A stored key is squeezed, so the ` - ` that delimited the marker is
    /// gone and only its words are left to strip.
    #[test]
    fn a_loved_key_loses_its_remaster_words() {
        let (_dir, mut conn) = open();
        let stored = format!("pink floyd{SEPARATOR}echoes 2011 remastered version");
        conn.execute(
            "INSERT INTO loved (match_key, remote) VALUES (?1, 1)",
            [&stored],
        )
        .unwrap();

        refold(&mut conn).unwrap();

        assert_eq!(keys(&conn, "loved"), [match_key("Pink Floyd", "Echoes")]);
        assert_eq!(refold(&mut conn).unwrap().moved, 0, "and it is idempotent");
    }

    /// A stored key has lost the `&`, so only the track it was the key of knows
    /// where it goes - and a track whose key stays keeps the love too.
    #[test]
    fn a_loved_key_follows_its_tracks_through_the_fold() {
        let (_dir, mut conn) = open();
        let stored = format!("simon garfunkel{SEPARATOR}the boxer");
        add_track(&conn, 1, Some("Simon & Garfunkel"), Some("The Boxer"));
        add_track(&conn, 2, Some("Simon Garfunkel"), Some("The Boxer"));
        conn.execute("UPDATE tracks SET match_key = ?1", [&stored])
            .unwrap();
        conn.execute(
            "INSERT INTO loved (match_key, remote) VALUES (?1, 0)",
            [&stored],
        )
        .unwrap();

        refold(&mut conn).unwrap();

        let mut loved = crate::db::loved::tracks(&conn).unwrap();
        loved.sort();
        assert_eq!(loved, [1, 2]);
        assert_eq!(refold(&mut conn).unwrap().moved, 0, "and it is idempotent");
    }

    /// Issue 170's letters, on a library whose stored keys kept `ß` whole.
    #[test]
    fn a_library_on_the_previous_fold_spells_its_letters_out_once() {
        let (_dir, mut conn) = open();
        let stored = format!("von thronstahl{SEPARATOR}ganz in weiß und ganz in eisen");
        add_track(
            &conn,
            1,
            Some("Von Thronstahl"),
            Some("Ganz in Weiß und ganz in Eisen"),
        );
        conn.execute("UPDATE tracks SET match_key = ?1", [&stored])
            .unwrap();
        conn.execute(
            "INSERT INTO loved (match_key, remote) VALUES (?1, 0)",
            [&stored],
        )
        .unwrap();
        played(
            &conn,
            10,
            "Von Thronstahl",
            "Ganz In Weiss Und Ganz In Eisen",
        );
        crate::db::settings::set(&conn, crate::db::settings::MATCH_FOLD, "4").unwrap();

        assert!(refold_if_stale(&mut conn).unwrap().is_some());
        assert_eq!(linked(&conn, 10), Some(1));
        assert_eq!(
            keys(&conn, "loved"),
            [match_key(
                "Von Thronstahl",
                "Ganz In Weiss Und Ganz In Eisen"
            )]
        );
        assert_eq!(refold_if_stale(&mut conn).unwrap(), None, "once");
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

    /// Retags track `id` the way `tags::write` would, and relinks.
    fn retag(conn: &Connection, id: i64, tags: &LinkTags) -> u32 {
        let before = link_tags(conn, id).unwrap().unwrap();
        write_tags(conn, id, tags);
        relink(conn, &[(id, before)]).unwrap()
    }

    fn write_tags(conn: &Connection, id: i64, tags: &LinkTags) {
        conn.execute(
            "UPDATE tracks SET artist = ?2, title = ?3, album = ?4, album_artist = ?5,
                               match_key = ?6
              WHERE id = ?1",
            rusqlite::params![
                id,
                tags.artist,
                tags.title,
                tags.album,
                tags.album_artist,
                track_key(tags.artist.as_deref(), tags.title.as_deref()),
            ],
        )
        .unwrap();
    }

    fn tags(artist: &str, title: &str, album: &str) -> LinkTags {
        LinkTags {
            artist: Some(artist.to_owned()),
            title: Some(title.to_owned()),
            album: Some(album.to_owned()),
            album_artist: None,
        }
    }

    #[test]
    fn a_retag_that_gives_a_play_its_key_unlinks_the_group_it_leaves() {
        let (_dir, conn) = open();
        harmonie(&conn);
        on_album(&conn, 3, "Franz Josef Degenhardt", "Spiel nicht", "Bad");
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
        assert_eq!((linked(&conn, 10), linked(&conn, 11)), (Some(1), Some(2)));

        // Neither play 11's key nor its album is one the retag names.
        retag(
            &conn,
            3,
            &tags("Franz Josef Degenhardt", "Mods", "Spiel nicht"),
        );

        assert_eq!((linked(&conn, 10), linked(&conn, 11)), (Some(3), None));
        assert_eq!(resolve(&conn).unwrap(), 0);
    }

    #[test]
    fn a_relink_leaves_whether_the_log_is_resolved_as_it_found_it() {
        let (_dir, conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));
        record(&conn, 1, 1_700_000_000).unwrap();
        assert!(!is_resolved(&conn).unwrap());

        retag(&conn, 1, &tags("Blue Room", "Lighthouse", ""));

        assert!(!is_resolved(&conn).unwrap());
    }

    type Snapshot = (Vec<(i64, Option<i64>)>, Vec<(i64, i64, Option<i64>)>);

    /// Every play's link and every track's count, in id order.
    fn snapshot(conn: &Connection) -> Snapshot {
        let mut plays = conn
            .prepare("SELECT id, track_id FROM plays ORDER BY id")
            .unwrap();
        let mut tracks = conn
            .prepare("SELECT id, play_count, last_played_at FROM tracks ORDER BY id")
            .unwrap();
        (
            plays
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .map(Result::unwrap)
                .collect(),
            tracks
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .unwrap()
                .map(Result::unwrap)
                .collect(),
        )
    }

    /// Whatever a retag moves, a full pass after it finds nothing left to move
    /// or count.
    #[test]
    fn a_relink_leaves_every_play_where_a_full_resolve_would() {
        const ARTISTS: &[&str] = &["Band", "Other", "Band mit Guest", "Merged"];
        const TITLES: &[&str] = &["Cleansing", "Harbour", "Dea Artio", "Anchor", "Mods"];
        const ALBUMS: &[&str] = &[
            "",
            "Hunters",
            "Hunters (Deluxe Edition)",
            "Roadburn",
            "Lighthouse",
        ];
        // Spellings no track carries, for the album and near-title tiers.
        const HEARD: &[&str] = &["Dia Artio", "Unheard", "harbour"];

        // xorshift, so a failing round is the same round on every run.
        let mut state: u64 = 0x9e37_79b9_7f4a_7c15;
        let mut next = |below: usize| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state % below as u64) as usize
        };
        fn pick(from: &[&'static str], next: &mut impl FnMut(usize) -> usize) -> &'static str {
            from[next(from.len())]
        }
        fn field(
            held: &Option<String>,
            from: &[&'static str],
            next: &mut impl FnMut(usize) -> usize,
        ) -> Option<String> {
            match next(4) {
                0 => None,
                1 | 2 => Some(pick(from, next).to_owned()),
                _ => held.clone(),
            }
        }

        let (_dir, conn) = open();
        for id in 1..=10 {
            let artist = pick(ARTISTS, &mut next);
            let album = pick(ALBUMS, &mut next);
            on_album(&conn, id, artist, album, pick(TITLES, &mut next));
            if next(3) == 0 {
                conn.execute(
                    "UPDATE tracks SET album_artist = ?2 WHERE id = ?1",
                    rusqlite::params![id, pick(ARTISTS, &mut next)],
                )
                .unwrap();
            }
            if next(5) == 0 {
                conn.execute("UPDATE tracks SET missing_since = 1 WHERE id = ?1", [id])
                    .unwrap();
            }
        }
        for started_at in 1..=120 {
            let title = if next(4) == 0 {
                pick(HEARD, &mut next)
            } else {
                pick(TITLES, &mut next)
            };
            let artist = pick(ARTISTS, &mut next);
            played_on(&conn, started_at, artist, pick(ALBUMS, &mut next), title);
        }
        resolve(&conn).unwrap();
        count(&conn).unwrap();

        let mut moved = 0;
        for round in 0..300 {
            let mut before: Vec<(i64, LinkTags)> = Vec::new();
            for _ in 0..=next(3) {
                let id = next(10) as i64 + 1;
                if before.iter().any(|(held, _)| *held == id) {
                    continue;
                }
                let held = link_tags(&conn, id).unwrap().unwrap();
                let after = LinkTags {
                    artist: field(&held.artist, ARTISTS, &mut next),
                    title: field(&held.title, TITLES, &mut next),
                    album: field(&held.album, ALBUMS, &mut next),
                    album_artist: field(&held.album_artist, ARTISTS, &mut next),
                };
                write_tags(&conn, id, &after);
                before.push((id, held));
            }
            moved += relink(&conn, &before).unwrap();
            let scoped = snapshot(&conn);

            assert_eq!(resolve(&conn).unwrap(), 0, "round {round}");
            count(&conn).unwrap();
            assert_eq!(snapshot(&conn), scoped, "round {round}");
        }
        assert!(moved > 300, "the retags moved too little to prove anything");
    }
}
