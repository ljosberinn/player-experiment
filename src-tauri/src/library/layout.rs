//! Where a file goes.
//!
//! The layout as a pure function: a release, one of its tracks, and the root
//! they are filed under, in - a relative path out. No filesystem, no move, no
//! setting; [83b](../../../docs/issues/done/83b-moving-one-release.md) does
//! the moving and
//! [83c](../../../docs/issues/done/83c-turning-the-library-folder-on.md)
//! turns it on.
//!
//! ```text
//! Ukendt Kunstner/Forbandede Ungdom - 2014 - Album/11 - Englebarn.mp3
//! └ album artist  └ release      └ year └ type   └ track  └ title
//! ```

use std::path::{Path, PathBuf};

use crate::scan::AUDIO_EXTENSIONS;

/// The facts every file of one release shares, and so the two folders above it.
///
/// `album_artist` and `artist` both, rather than one resolved name: the top
/// folder is `db::query`'s `GROUP_ARTIST` and the release folder its
/// `GROUP_ALBUM`, because a release the grid draws as one tile has to be one
/// folder and the tile is drawn from those expressions. It is also the key
/// [82b](../../../docs/issues/done/82b-the-unattended-lookup-pass.md) looks a
/// release up by, so all three phases agree on what a release is.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Release<'a> {
    pub album_artist: Option<&'a str>,
    pub artist: Option<&'a str>,
    pub album: Option<&'a str>,
    pub year: Option<i64>,
    /// MusicBrainz's release-group primary type, as `tracks.release_type`
    /// caches it. `None` for everything 82b has not looked up.
    pub release_type: Option<&'a str>,
    /// How many discs the release has, counted over its rows by the caller
    /// with a missing disc number counting as disc one. Only whether it is
    /// more than one matters here.
    pub disc_count: u32,
}

/// The facts that differ per file.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TrackFile<'a> {
    pub disc_no: Option<i64>,
    pub track_no: Option<i64>,
    pub title: Option<&'a str>,
    /// The track's own artist, which joins the filename only where it differs
    /// from the folder's.
    pub artist: Option<&'a str>,
    /// Carried over from the source path verbatim, case included: the mover
    /// renames files, it does not re-case what an encoder wrote.
    pub extension: Option<&'a str>,
}

/// Windows' path ceiling, the terminating NUL included.
///
/// There is no `longPathAware` manifest in `src-tauri`, and Rust's `std::fs`
/// hands paths to the wide Win32 API without adding a `\\?\` prefix of its own,
/// so this is the ceiling for every path this app builds. Prefixing `\\?\`
/// ourselves was considered and declined - it would let this module name paths
/// the user's own file manager, and every other `std::fs` call in this
/// codebase, cannot then open.
const MAX_PATH: usize = 260;

/// The separators between the root and the three segments below it.
const SEPARATORS: usize = 3;

/// The fewest characters a segment is ever cut down to.
///
/// Eight rather than fewer because it is what lets `escape_reserved` add its
/// underscore after a cut without checking the budget: the longest name in
/// [`RESERVED`] is four characters.
const MIN_SEGMENT: usize = 8;

const UNKNOWN_ARTIST: &str = "Unknown Artist";
const UNKNOWN_RELEASE: &str = "Unknown Release";
const UNKNOWN_YEAR: &str = "0000";
const UNKNOWN_TRACK: &str = "00";
const UNKNOWN_TITLE: &str = "Unknown Title";

/// What 8 of 10 releases are. A sixth placeholder segment would put
/// `Unknown Type` in the name of most folders in the library.
const DEFAULT_TYPE: &str = "Album";

/// Windows rejects a path containing any of these outright.
const ILLEGAL: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// The DOS device names, which cannot be a file or folder name at any depth,
/// with or without an extension. `Con` and `Aux` are real titles.
const RESERVED: [&str; 24] = [
    "CON", "PRN", "AUX", "NUL", "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
    "COM8", "COM9", "LPT0", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Where `track` goes, relative to `root`.
///
/// `root` is read for its length alone - the path comes back relative so the
/// caller can compare it against a row without caring where the root moved to.
pub fn relative_path(root: &Path, release: &Release, track: &TrackFile) -> PathBuf {
    let folder_artist = group_artist(release);
    let artist = prepare(folder_artist, UNKNOWN_ARTIST);
    let release_folder = prepare(&release_folder(release), UNKNOWN_RELEASE);
    let stem = prepare(&file_stem(release, track, folder_artist), UNKNOWN_TITLE);

    // A root deep enough to leave nothing is floored rather than cut to
    // nothing, and refused by 83c at the picker instead.
    let budget = segment_budget(root, track.extension).max(SEPARATORS * MIN_SEGMENT);
    // The filename is reserved first: it is the segment carrying the track's
    // identity, where the folders above it repeat what the row already says.
    let for_name = utf16_len(&stem).min(budget - 2 * MIN_SEGMENT);
    let (for_artist, for_release) = share(
        utf16_len(&artist),
        utf16_len(&release_folder),
        budget - for_name,
    );

    PathBuf::from(finish(&artist, for_artist))
        .join(finish(&release_folder, for_release))
        .join(file_name(&stem, track.extension, for_name))
}

/// Whether `root` leaves enough of [`MAX_PATH`] for a path to be built under it
/// at all.
///
/// [83c](../../../docs/issues/done/83c-turning-the-library-folder-on.md)
/// refuses a root this rejects, at the picker: better a sentence in Settings
/// than every name in the library cut to nothing.
pub fn has_path_budget(root: &Path) -> bool {
    let longest = AUDIO_EXTENSIONS
        .iter()
        .copied()
        .max_by_key(|extension| utf16_len(extension));
    segment_budget(root, longest) >= SEPARATORS * MIN_SEGMENT
}

/// The same path with ` (nth)` before the extension, still inside
/// [`MAX_PATH`].
///
/// What [83b](../../../docs/issues/done/83b-moving-one-release.md) names a
/// collision with: two releases whose tags sanitize to one folder. Here rather
/// than in the mover because the ceiling is here - a path built to the last
/// character of its budget would otherwise outgrow it by the length of the
/// marker, and fail to be created at all.
pub fn suffixed(path: &Path, nth: u32) -> PathBuf {
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let extension = path
        .extension()
        .map(|extension| extension.to_string_lossy());
    let marker = format!(" ({nth})");

    // Everything but the stem: the folders, the separators and the extension,
    // none of which a collision may cut into.
    let around = utf16_len(&path.to_string_lossy()) - utf16_len(&stem);
    // One more than the marker, for the underscore `finish` adds when the cut
    // it makes lands on a device name.
    let room = (MAX_PATH - 1).saturating_sub(around + utf16_len(&marker) + 1);

    let mut name = finish(&stem, room);
    name.push_str(&marker);
    if let Some(extension) = extension {
        name.push('.');
        name.push_str(&extension);
    }
    path.with_file_name(name)
}

/// The artist a track is filed under: `db::query`'s `GROUP_ARTIST`, where
/// `nullif` folding `''` into NULL is why an empty tag is untagged here too.
fn group_artist<'a>(release: &Release<'a>) -> &'a str {
    non_empty(release.album_artist)
        .or(non_empty(release.artist))
        .unwrap_or(UNKNOWN_ARTIST)
}

fn release_folder(release: &Release) -> String {
    format!(
        "{} - {} - {}",
        non_empty(release.album).unwrap_or(UNKNOWN_RELEASE),
        release
            .year
            .map_or_else(|| UNKNOWN_YEAR.to_owned(), |year| format!("{year:04}")),
        non_empty(release.release_type).unwrap_or(DEFAULT_TYPE),
    )
}

/// The filename without its extension.
fn file_stem(release: &Release, track: &TrackFile, folder_artist: &str) -> String {
    let mut stem = String::new();

    // A subfolder per disc would split one release across two folders, and
    // 57,600 of 65,535 tracks have no disc number to put in one.
    if release.disc_count > 1 {
        stem.push_str(&format!("{}-", track.disc_no.unwrap_or(1)));
    }
    stem.push_str(
        &track
            .track_no
            .map_or_else(|| UNKNOWN_TRACK.to_owned(), |number| format!("{number:02}")),
    );

    // On a compilation this is the one thing identifying the track; on a normal
    // release it repeats the folder. Folded the way `COLLATE NOCASE` folds, so
    // the comparison agrees with the grouping that named the folder.
    if let Some(artist) =
        non_empty(track.artist).filter(|artist| !artist.eq_ignore_ascii_case(folder_artist))
    {
        stem.push_str(" - ");
        stem.push_str(artist);
    }

    stem.push_str(" - ");
    stem.push_str(non_empty(track.title).unwrap_or(UNKNOWN_TITLE));
    stem
}

/// The name of the file itself. `stem` has been through [`prepare`]; `limit`
/// covers it alone, because the extension is the one part a cut may never
/// reach.
fn file_name(stem: &str, extension: Option<&str>, limit: usize) -> String {
    let mut name = finish(stem, limit);
    if let Some(extension) = non_empty(extension) {
        name.push('.');
        name.push_str(&sanitize(extension));
    }
    name
}

/// What is left of [`MAX_PATH`] for the three segments under `root`.
///
/// A trailing separator on the root is not counted twice: `Path::join` does not
/// add a second one.
fn segment_budget(root: &Path, extension: Option<&str>) -> usize {
    let root = root.to_string_lossy();
    let root = utf16_len(root.trim_end_matches(['\\', '/']));
    let extension = extension.map_or(0, |extension| 1 + utf16_len(extension));
    (MAX_PATH - 1).saturating_sub(root + SEPARATORS + extension)
}

/// Splits `budget` between the two folder names, taking from the longer first
/// so one long release title does not cut the artist above it to nothing.
fn share(first: usize, second: usize, budget: usize) -> (usize, usize) {
    if first + second <= budget {
        return (first, second);
    }
    let half = budget / 2;
    if first.min(second) >= half {
        (budget - half, half)
    } else if first < second {
        (first, budget - first)
    } else {
        (budget - second, second)
    }
}

/// A segment as the rules leave it, before any of the budget is spent on it.
///
/// Before the budget rather than after, because a name the rules leave empty
/// falls back to `placeholder` and the placeholder is what then has to fit - an
/// artist tagged `...` becomes a junk drawer under the root, which is visible,
/// where a list of skipped files somewhere is not.
fn prepare(text: &str, placeholder: &str) -> String {
    // Windows silently strips trailing dots and spaces on creation and then
    // cannot address what it made.
    let sanitized = sanitize(text);
    let trimmed = sanitized.trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        return escape_reserved(placeholder);
    }
    // Escaped here rather than only after the cut, so the underscore is part of
    // the length the budget is split by instead of one character past it.
    escape_reserved(trimmed)
}

/// The same segment cut to its share of the budget.
fn finish(text: &str, limit: usize) -> String {
    // Trimmed again: the cut can expose a dot or a space that was interior.
    let cut = truncate(text, limit).trim_end_matches(['.', ' ']);
    if cut.is_empty() {
        // A name of nothing but dots this far in - `...And Justice for All`
        // cut inside the ellipsis. Never what the tag said, but a path with an
        // empty segment is not a path.
        return "_".to_owned();
    }
    // [`prepare`] already escaped the untruncated name, so this only fires on a
    // device name the cut itself created - `CON     X` cut to eight and trimmed
    // back to three. That name is at most four characters and [`share`] never
    // truncates to fewer than [`MIN_SEGMENT`], so the underscore has room.
    escape_reserved(cut)
}

/// Replaced rather than dropped: dropping turns `AC/DC` into `ACDC`, which is a
/// different band.
fn sanitize(text: &str) -> String {
    text.chars()
        .map(|character| {
            if ILLEGAL.contains(&character) || character.is_control() {
                '_'
            } else {
                character
            }
        })
        .collect()
}

/// The underscore lands on the stem rather than the end, because `CON.txt` is
/// reserved and `CON.txt_` would be a file the user did not name.
fn escape_reserved(name: &str) -> String {
    let stem = name.split_once('.').map_or(name, |(stem, _)| stem);
    if RESERVED
        .iter()
        .any(|reserved| stem.eq_ignore_ascii_case(reserved))
    {
        format!("{stem}_{}", &name[stem.len()..])
    } else {
        name.to_owned()
    }
}

/// A hard cut on a character boundary with no ellipsis: a truncated name is
/// already visibly truncated, and a marker only spends budget.
///
/// Measured in UTF-16 units, which is what Windows counts a path in - so a
/// library of Nordic titles gets the budget it actually has rather than the one
/// UTF-8 byte lengths would suggest.
fn truncate(text: &str, limit: usize) -> &str {
    let mut used = 0;
    for (offset, character) in text.char_indices() {
        let width = character.len_utf16();
        if used + width > limit {
            return &text[..offset];
        }
        used += width;
    }
    text
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Mirrors `nullif(column, '')`: a tag written as an empty string is untagged.
fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release() -> Release<'static> {
        Release {
            album_artist: Some("Ukendt Kunstner"),
            artist: Some("Ukendt Kunstner"),
            album: Some("Forbandede Ungdom"),
            year: Some(2014),
            release_type: Some("Album"),
            disc_count: 1,
        }
    }

    fn track() -> TrackFile<'static> {
        TrackFile {
            disc_no: None,
            track_no: Some(11),
            title: Some("Englebarn"),
            artist: Some("Ukendt Kunstner"),
            extension: Some("mp3"),
        }
    }

    fn path_of(release: &Release, track: &TrackFile) -> String {
        relative_path(Path::new("C:\\Music"), release, track)
            .to_string_lossy()
            .replace('\\', "/")
    }

    #[test]
    fn the_three_segments_are_the_two_grid_expressions_and_the_track() {
        assert_eq!(
            path_of(&release(), &track()),
            "Ukendt Kunstner/Forbandede Ungdom - 2014 - Album/11 - Englebarn.mp3"
        );
    }

    #[test]
    fn the_top_folder_falls_back_to_the_track_artist() {
        let release = Release {
            album_artist: None,
            artist: Some("Elffor"),
            ..release()
        };
        assert!(path_of(&release, &track()).starts_with("Elffor/"));
    }

    /// `GROUP_ARTIST` folds `''` into NULL, so a tag written as an empty string
    /// is untagged rather than a folder of its own.
    #[test]
    fn an_album_artist_written_as_an_empty_string_is_untagged() {
        let release = Release {
            album_artist: Some(""),
            artist: Some("Elffor"),
            ..release()
        };
        assert!(path_of(&release, &track()).starts_with("Elffor/"));
    }

    #[test]
    fn a_colon_in_a_title_becomes_an_underscore() {
        let track = TrackFile {
            title: Some("Addicts: Black Meddle Pt. 2"),
            ..track()
        };
        assert!(path_of(&release(), &track).ends_with("/11 - Addicts_ Black Meddle Pt. 2.mp3"));
    }

    #[test]
    fn a_slash_is_replaced_rather_than_dropped() {
        let release = Release {
            album_artist: Some("AC/DC"),
            ..release()
        };
        let track = TrackFile {
            artist: Some("AC/DC"),
            title: Some("Nachtmystium/Murmur"),
            ..track()
        };
        let path = path_of(&release, &track);
        assert!(path.starts_with("AC_DC/"), "{path}");
        assert!(path.ends_with("/11 - Nachtmystium_Murmur.mp3"), "{path}");
    }

    #[test]
    fn every_control_character_becomes_an_underscore() {
        let release = Release {
            album_artist: Some("Fa\u{7}ust\u{1}"),
            ..release()
        };
        assert!(path_of(&release, &track()).starts_with("Fa_ust_/"));
    }

    /// Windows strips these on creation and then cannot address the folder it
    /// made, so they go before the path is handed over.
    #[test]
    fn trailing_dots_and_spaces_are_dropped() {
        let release = Release {
            album_artist: Some("Burzum. "),
            ..release()
        };
        assert!(path_of(&release, &track()).starts_with("Burzum/"));
    }

    #[test]
    fn a_reserved_device_name_is_not_a_folder_name() {
        for name in ["NUL", "aux", "Con", "COM1", "lpt9"] {
            let release = Release {
                album_artist: Some(name),
                ..release()
            };
            let path = path_of(&release, &track());
            assert!(
                path.starts_with(&format!("{name}_/")),
                "{name} was left addressing a device: {path}"
            );
        }
    }

    /// `NUL.mp3` is as reserved as `NUL`, so the check runs on the stem rather
    /// than on the whole name.
    #[test]
    fn a_reserved_device_name_is_reserved_with_an_extension_too() {
        assert_eq!(file_name("NUL", Some("mp3"), 32), "NUL_.mp3");
    }

    #[test]
    fn a_device_name_the_cut_itself_creates_is_escaped_too() {
        assert_eq!(finish("CON     X", 8), "CON_");
    }

    /// The one case where the escape and the budget compete: the name is short
    /// enough to be a device and the release title beside it has taken every
    /// character that was left.
    #[test]
    fn escaping_a_device_name_does_not_spend_budget_the_split_withheld() {
        let root = PathBuf::from(format!("C:\\{}", "deep\\".repeat(30)));
        let long = "Looking for Europe The Neofolk Compendium".repeat(3);
        let release = Release {
            album_artist: Some("NUL"),
            album: Some(&long),
            ..release()
        };
        let track = TrackFile {
            artist: Some("NUL"),
            title: Some(&long),
            ..track()
        };

        let full = root.join(relative_path(&root, &release, &track));
        let length = utf16_len(&full.to_string_lossy());
        assert!(length < MAX_PATH, "{length} characters: {full:?}");
        assert!(
            full.to_string_lossy().contains("NUL_"),
            "and the device name is still escaped: {full:?}"
        );
    }

    #[test]
    fn a_segment_left_empty_by_the_rules_falls_back_to_its_placeholder() {
        let release = Release {
            album_artist: Some("..."),
            ..release()
        };
        assert!(path_of(&release, &track()).starts_with("Unknown Artist/"));
    }

    #[test]
    fn a_multi_disc_release_prefixes_the_filename() {
        let release = Release {
            disc_count: 2,
            ..release()
        };
        let track = TrackFile {
            disc_no: Some(2),
            track_no: Some(7),
            ..track()
        };
        assert!(path_of(&release, &track).ends_with("/2-07 - Englebarn.mp3"));
    }

    /// 57,600 of 65,535 tracks have no disc number, and a subfolder per disc
    /// would split one release across two folders.
    #[test]
    fn a_single_disc_release_does_not() {
        let track = TrackFile {
            disc_no: Some(1),
            track_no: Some(7),
            ..track()
        };
        assert!(path_of(&release(), &track).ends_with("/07 - Englebarn.mp3"));
    }

    #[test]
    fn a_track_on_a_multi_disc_release_with_no_disc_number_is_on_disc_one() {
        let release = Release {
            disc_count: 2,
            ..release()
        };
        let track = TrackFile {
            disc_no: None,
            ..track()
        };
        assert!(path_of(&release, &track).ends_with("/1-11 - Englebarn.mp3"));
    }

    /// On a compilation the track artist is the one thing identifying the
    /// track.
    #[test]
    fn a_track_artist_that_differs_joins_the_filename() {
        let release = Release {
            album_artist: Some("Various Artists"),
            ..release()
        };
        let track = TrackFile {
            artist: Some("Elffor"),
            title: Some("Kortirion Among The Trees"),
            ..track()
        };
        assert!(path_of(&release, &track).ends_with("/11 - Elffor - Kortirion Among The Trees.mp3"));
    }

    #[test]
    fn a_track_artist_that_matches_the_folder_does_not() {
        let track = TrackFile {
            artist: Some("ukendt kunstner"),
            ..track()
        };
        assert!(
            path_of(&release(), &track).ends_with("/11 - Englebarn.mp3"),
            "the comparison folds case, the way the grid groups"
        );
    }

    #[test]
    fn every_missing_field_gets_a_placeholder_segment() {
        let release = Release {
            album_artist: None,
            artist: None,
            album: None,
            year: None,
            release_type: None,
            disc_count: 1,
        };
        let track = TrackFile {
            disc_no: None,
            track_no: None,
            title: None,
            artist: None,
            extension: None,
        };
        assert_eq!(
            path_of(&release, &track),
            "Unknown Artist/Unknown Release - 0000 - Album/00 - Unknown Title"
        );
    }

    #[test]
    fn a_release_with_no_type_is_an_album() {
        let release = Release {
            release_type: None,
            ..release()
        };
        assert!(path_of(&release, &track()).contains("/Forbandede Ungdom - 2014 - Album/"));
    }

    #[test]
    fn a_deep_root_cuts_the_segments_rather_than_the_path() {
        let root = PathBuf::from(format!("C:\\{}", "deep\\".repeat(30)));
        let release = Release {
            album_artist: Some("Various Artists"),
            album: Some("Looking for Europe: The Neofolk Compendium"),
            ..release()
        };
        let track = TrackFile {
            artist: Some("Sonne Hagal"),
            title: Some("Der Wanderer Uber Dem Nebelmeer"),
            ..track()
        };

        let relative = relative_path(&root, &release, &track);
        let full = root.join(&relative);
        let length = utf16_len(&full.to_string_lossy());
        assert!(length < MAX_PATH, "{length} characters: {full:?}");
        assert_eq!(
            relative
                .extension()
                .and_then(|extension| extension.to_str()),
            Some("mp3"),
            "the extension is never what gets cut"
        );
        assert_eq!(
            relative.components().count(),
            3,
            "a cut segment is still a segment"
        );
    }

    /// The cut lands on a character boundary, so a truncated segment is still a
    /// name and not a broken string.
    #[test]
    fn the_cut_lands_on_a_character_boundary() {
        let root = PathBuf::from(format!("C:\\{}", "deep\\".repeat(30)));
        let title = "Sørgelig\u{e9}vinter".repeat(20);
        let track = TrackFile {
            title: Some(&title),
            ..track()
        };
        let relative = relative_path(&root, &release(), &track);
        assert!(relative.to_str().is_some());
        assert!(utf16_len(&root.join(&relative).to_string_lossy()) < MAX_PATH);
    }

    /// Nothing left over is fine; going over the ceiling is a rename that fails
    /// at the end of a four-hour run.
    #[test]
    fn no_path_under_a_root_with_budget_left_exceeds_the_ceiling() {
        let long = "Looking for Europe The Neofolk Compendium ".repeat(6);
        let release = Release {
            album_artist: Some(&long),
            album: Some(&long),
            ..release()
        };
        let track = TrackFile {
            artist: Some("Sonne Hagal"),
            title: Some(&long),
            ..track()
        };

        for depth in 0..40 {
            let root = PathBuf::from(format!("C:\\{}", "deep\\".repeat(depth)));
            if !has_path_budget(&root) {
                continue;
            }
            let full = root.join(relative_path(&root, &release, &track));
            let length = utf16_len(&full.to_string_lossy());
            assert!(length < MAX_PATH, "depth {depth}: {length} characters");
        }
    }

    #[test]
    fn the_cut_comes_off_the_longer_folder_first() {
        assert_eq!(share(10, 20, 50), (10, 20), "nothing to cut");
        assert_eq!(share(15, 57, 50), (15, 35), "the short one is left whole");
        assert_eq!(share(100, 100, 50), (25, 25), "neither can be");
    }

    #[test]
    fn a_root_with_nothing_left_of_the_budget_is_refused() {
        assert!(has_path_budget(Path::new("C:\\Music")));
        assert!(!has_path_budget(&PathBuf::from(format!(
            "C:\\{}",
            "deep\\".repeat(50)
        ))));
    }

    #[test]
    fn a_collision_marker_goes_before_the_extension() {
        assert_eq!(
            suffixed(Path::new("C:\\Music\\Elffor\\11 - Kortirion.mp3"), 2)
                .to_string_lossy()
                .replace('\\', "/"),
            "C:/Music/Elffor/11 - Kortirion (2).mp3"
        );
    }

    /// The marker is four characters the budget never reserved, so a path built
    /// to the last of it pays for them out of the stem.
    #[test]
    fn a_collision_marker_does_not_push_a_path_over_the_ceiling() {
        let long = "Looking for Europe The Neofolk Compendium ".repeat(6);
        let release = Release {
            album_artist: Some(&long),
            album: Some(&long),
            ..release()
        };
        let track = TrackFile {
            title: Some(&long),
            ..track()
        };
        let root = PathBuf::from(format!("C:\\{}", "deep\\".repeat(20)));
        let full = root.join(relative_path(&root, &release, &track));

        let marked = suffixed(&full, 2);

        assert!(
            utf16_len(&marked.to_string_lossy()) < MAX_PATH,
            "{}",
            marked.display()
        );
        assert!(marked.to_string_lossy().ends_with(" (2).mp3"));
    }
}
