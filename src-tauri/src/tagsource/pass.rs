//! One release, looked up with nobody watching.
//!
//! The rules 79b's dialog leaves to a person, written down: which candidate,
//! whether it is certain enough to write, and what to write. Everything here
//! is a function over a connection and a transport - the thread that drives it
//! is in [`crate::tagsource::worker`], and none of it is needed to test a
//! rule.
//!
//! **A reversal, deliberately.** The dialog confirms every match by hand and
//! conventions calls the file the source of truth. Both still hold for
//! uncertain matches; a release whose track count, track order and per-track
//! durations all agree with MusicBrainz is not a guess, and confirming eight
//! thousand of those by hand is not review, it is clicking.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db::{lookup, query};
use crate::error::AppResult;
use crate::model::{CoverEdit, ReleaseDetail, TagEdit};
use crate::scan::ScanLock;
use crate::tagsource::score::{LocalRelease, UNATTENDED_THRESHOLD};
use crate::tagsource::transport::Transport;
use crate::{tags, tagsource};

/// The environment variable that turns the pass into a report.
///
/// How the threshold is tuned: run a whole pass over a real library, read the
/// verdicts it would have reached, and move the number. A testing affordance
/// rather than a feature - no command, no setting, no UI.
pub const DRY_RUN_VAR: &str = "APEX_LOOKUP_DRY_RUN";

/// Whether this process was started to report rather than to write.
pub fn dry_run() -> bool {
    std::env::var_os(DRY_RUN_VAR).is_some_and(|value| !value.is_empty())
}

/// What one release came to.
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    Written {
        mbid: String,
        score: f32,
        tracks: u32,
    },
    Queued {
        score: f32,
        candidates: usize,
    },
    /// MusicBrainz has nothing for it. Recorded so it is not searched again,
    /// and not queued: there is nothing for the user to decide.
    NotFound,
}

/// Looks one release up and acts on the answer.
///
/// Two MusicBrainz calls and no way to make it fewer: `search` for candidates,
/// then `fetch` on the best, because the per-track durations that separate two
/// pressings do not exist until a tracklist does. The cover rides along with
/// the fetch, free, because the Cover Art Archive has no rate limit.
pub fn look_up(
    conn: &mut Connection,
    transport: &(dyn Transport + '_),
    lock: &ScanLock,
    release: &lookup::Release,
    staging: &Path,
    dry_run: bool,
    now: i64,
) -> AppResult<Verdict> {
    let members =
        query::release_members(conn, release.album.as_deref(), release.artist.as_deref())?;
    let local = LocalRelease {
        track_count: u32::try_from(members.len()).unwrap_or(u32::MAX),
        durations_ms: members.iter().map(|member| member.duration_ms).collect(),
    };

    let candidates = tagsource::musicbrainz::search(
        transport,
        release.album.as_deref(),
        release.artist.as_deref(),
        &local,
    )?;
    let Some(best) = candidates.first() else {
        if !dry_run {
            lookup::record(
                conn,
                release,
                lookup::Status::NotFound,
                None,
                None,
                None,
                now,
            )?;
        }
        return Ok(Verdict::NotFound);
    };

    let (detail, cover) = tagsource::fetch_release(transport, &best.mbid, &local)?;
    let score = detail.candidate.score;

    // The track count has to agree, not merely score well. A perfect text
    // match with eleven of twelve tracks reaches 0.954, and the write maps
    // remote tracks onto files by position - so a length that disagrees would
    // put every title on the wrong file at a score above the bar.
    let confident = score >= UNATTENDED_THRESHOLD && detail.tracks.len() == members.len();
    if !confident {
        let candidates_json = serde_json::to_string(&candidates).ok();
        if !dry_run {
            lookup::record(
                conn,
                release,
                lookup::Status::Review,
                Some(&best.mbid),
                Some(score),
                candidates_json.as_deref(),
                now,
            )?;
        }
        return Ok(Verdict::Queued {
            score,
            candidates: candidates.len(),
        });
    }

    let tracks = u32::try_from(detail.tracks.len()).unwrap_or(u32::MAX);
    if dry_run {
        return Ok(Verdict::Written {
            mbid: detail.candidate.mbid,
            score,
            tracks,
        });
    }

    // Only where the release has none: over 8,044 releases, staging a JPEG to
    // replace artwork that is already there is 8,044 needless rewrites of
    // whole audio files.
    let staged = match cover.filter(|_| members.iter().all(|member| member.cover_hash.is_none())) {
        Some(bytes) => stage(staging, &best.mbid, &bytes),
        None => None,
    };

    let edits = edits_for(&members, &detail, staged.as_deref());
    {
        // Behind the same lock as a scan, because this rewrites the files a
        // scan reads its (mtime, size) from - and per write rather than for the
        // pass, because holding it for four and a half hours would block every
        // scan in that window.
        let _guard = lock.acquire();
        tags::write::apply(conn, &edits, |_| {})?;
    }
    if let Some(path) = staged {
        // One at a time, rather than 8,044 of them left in the cache.
        let _ = std::fs::remove_file(path);
    }

    lookup::record(
        conn,
        release,
        lookup::Status::Resolved,
        Some(&detail.candidate.mbid),
        Some(score),
        None,
        now,
    )?;

    Ok(Verdict::Written {
        mbid: detail.candidate.mbid,
        score,
        tracks,
    })
}

/// Writes the fetched cover to its own file, named for the release.
///
/// Not `commands::stage_cover`'s fixed name: that one file is what an open tag
/// editor is previewing over `cover://`, and a pass writing through it would
/// swap the picture under the user.
fn stage(staging: &Path, mbid: &str, bytes: &[u8]) -> Option<PathBuf> {
    let mime = tags::write::check_cover(bytes).ok()?;
    let extension = if mime == "image/png" { "png" } else { "jpg" };
    let path = staging.join(format!("lookup-{mbid}.{extension}"));
    std::fs::write(&path, bytes).ok()?;
    Some(path)
}

/// One edit per file, mapped onto the tracklist by position.
///
/// Position is the mapping the score was computed over, so it is the mapping
/// the write applies - a score measured over one pairing and a write that made
/// another would be scoring an apply that never happens. The caller has
/// already refused a tracklist of a different length.
///
/// The genre is set only where the file has none, which is all "filled, never
/// overwritten" costs: absent means leave alone. The comment is never
/// mentioned, so it is never touched.
fn edits_for(
    members: &[query::ReleaseMember],
    detail: &ReleaseDetail,
    cover_path: Option<&Path>,
) -> Vec<(i64, TagEdit)> {
    members
        .iter()
        .zip(&detail.tracks)
        .map(|(member, track)| {
            (
                member.id,
                TagEdit {
                    title: Some(track.title.clone()),
                    artist: Some(track.artist.clone()),
                    album: Some(detail.candidate.title.clone()),
                    album_artist: Some(detail.album_artist.clone()),
                    genre: member
                        .genre
                        .is_none()
                        .then(|| detail.genre.clone())
                        .flatten(),
                    comment: None,
                    year: detail.year.map(|year| year.to_string()),
                    track_no: Some(track.track_no.to_string()),
                    disc_no: Some(track.disc_no.to_string()),
                    release_mbid: Some(detail.candidate.mbid.clone()),
                    release_group_mbid: detail.candidate.release_group_mbid.clone(),
                    release_type: detail.release_type.clone(),
                    cover: cover_path.map(|path| CoverEdit::Replace {
                        path: path.to_string_lossy().into_owned(),
                    }),
                },
            )
        })
        .collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::Db;
    use crate::tagsource::transport::FakeTransport;

    const SEARCH_JSON: &str = include_str!("fixtures/search-loveless.json");
    const RELEASE_JSON: &str = include_str!("fixtures/release-loveless.json");

    /// The eleven lengths `release-loveless.json` carries. A library built
    /// from these agrees with it perfectly, which is what puts a candidate
    /// over the bar.
    pub(crate) const LOVELESS_DURATIONS: [i64; 11] = [
        268_000, 148_000, 56_000, 345_000, 258_000, 336_000, 240_000, 316_000, 213_000, 328_000,
        // "Soon" is the one MusicBrainz has no length for, so nothing here can
        // disagree with it.
        0,
    ];

    /// One frame of silent MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono - the
    /// same shape `tests/fixture` generates. Repeated here rather than shared
    /// because `FakeTransport` is `#[cfg(test)]`, so these tests cannot live
    /// in `tests/` where that module is.
    fn silent_mp3() -> Vec<u8> {
        let mut frame = vec![0xFF, 0xFB, 0x90, 0xC0];
        frame.resize(417, 0);
        frame.repeat(40)
    }

    /// The fetch needle is registered first because it is the more specific
    /// one: the search URL has no trailing slash, so it falls through.
    pub(crate) fn musicbrainz() -> FakeTransport {
        FakeTransport::new()
            .answering("/ws/2/release/", RELEASE_JSON)
            .answering("/ws/2/release", SEARCH_JSON)
            .missing("coverartarchive.org")
    }

    /// A library of `durations_ms.len()` real files, all one release.
    ///
    /// The album and artist go onto the **files**, not only the rows: every
    /// write syncs the row back from disk, so a release that existed only in
    /// the database would dissolve the first time anything wrote to it.
    ///
    /// The durations are the exception and stay in the rows, because nothing
    /// syncs them and generating eleven different lengths of silence would be
    /// a slower way to say the same thing.
    pub(crate) fn library(
        album: &str,
        artist: &str,
        durations_ms: &[i64],
    ) -> (tempfile::TempDir, Db) {
        use lofty::config::WriteOptions;
        use lofty::prelude::{Accessor, ItemKey, TagExt};
        use lofty::tag::{Tag, TagType};

        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        let audio = silent_mp3();

        for (index, duration) in durations_ms.iter().enumerate() {
            let track_no = index as i64 + 1;
            let path = dir.path().join(format!("{album}-{track_no:02}.mp3"));
            std::fs::write(&path, &audio).unwrap();

            let mut tag = Tag::new(TagType::Id3v2);
            tag.set_album(album.to_owned());
            tag.set_artist(artist.to_owned());
            tag.insert_text(ItemKey::AlbumArtist, artist.to_owned());
            tag.set_track(track_no as u32);
            tag.save_to_path(&path, WriteOptions::default()).unwrap();

            conn.execute(
                "INSERT INTO tracks (path, mtime, size, duration_ms, album, album_artist, artist,
                                     track_no, added_at)
                 VALUES (?1, 0, 0, ?2, ?3, ?4, ?4, ?5, 0)",
                rusqlite::params![path.to_string_lossy(), duration, album, artist, track_no],
            )
            .unwrap();
        }

        (dir, db)
    }

    fn loveless() -> lookup::Release {
        lookup::Release {
            album: Some("Loveless".to_owned()),
            artist: Some("My Bloody Valentine".to_owned()),
        }
    }

    fn titles(conn: &Connection) -> Vec<Option<String>> {
        conn.prepare("SELECT title FROM tracks ORDER BY track_no")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    fn untitled(conn: &Connection) -> i64 {
        conn.query_row(
            "SELECT count(*) FROM tracks WHERE title IS NOT NULL",
            [],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn a_confident_match_is_written_to_every_file_of_the_release() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        let mut conn = db.conn().unwrap();

        let verdict = look_up(
            &mut conn,
            &musicbrainz(),
            &ScanLock::default(),
            &loveless(),
            dir.path(),
            false,
            100,
        )
        .unwrap();

        assert!(matches!(verdict, Verdict::Written { .. }), "{verdict:?}");
        assert_eq!(titles(&conn)[0].as_deref(), Some("Only Shallow"));

        let (status, mbid, release_type): (String, String, Option<String>) = conn
            .query_row(
                "SELECT l.status, l.release_mbid, (SELECT release_type FROM tracks LIMIT 1)
                   FROM release_lookup l",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(status, "resolved");
        assert_eq!(mbid, "bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9");
        assert_eq!(
            release_type.as_deref(),
            Some("Album"),
            "the write carries the whole identity, type included"
        );
    }

    #[test]
    fn a_doubtful_match_is_queued_with_its_candidates_and_writes_nothing() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &[600_000; 11]);
        let mut conn = db.conn().unwrap();

        let verdict = look_up(
            &mut conn,
            &musicbrainz(),
            &ScanLock::default(),
            &loveless(),
            dir.path(),
            false,
            100,
        )
        .unwrap();

        assert!(matches!(verdict, Verdict::Queued { .. }), "{verdict:?}");
        assert_eq!(untitled(&conn), 0, "below the bar nothing is written");

        let (status, candidates): (String, String) = conn
            .query_row(
                "SELECT status, candidates_json FROM release_lookup",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "review");
        assert!(
            candidates.contains("bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9"),
            "a review opens on these rather than paying for the search again"
        );
    }

    #[test]
    fn a_release_with_no_candidates_is_left_alone_and_not_queued() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        let mut conn = db.conn().unwrap();
        let transport = FakeTransport::new().answering("/ws/2/release", r#"{"releases":[]}"#);

        let verdict = look_up(
            &mut conn,
            &transport,
            &ScanLock::default(),
            &loveless(),
            dir.path(),
            false,
            100,
        )
        .unwrap();

        assert_eq!(verdict, Verdict::NotFound);
        assert_eq!(untitled(&conn), 0);
        assert_eq!(
            conn.query_row("SELECT status FROM release_lookup", [], |row| row
                .get::<_, String>(0))
                .unwrap(),
            "none",
            "recorded so it is never searched again, but not put to the user"
        );
        assert_eq!(transport.call_count(), 1, "no candidate, no fetch");
    }

    #[test]
    fn an_empty_genre_is_filled_and_one_that_is_there_is_left_alone() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        let mut conn = db.conn().unwrap();
        // Onto the file rather than the row: the write syncs the row back from
        // disk, so a genre only in the row would be gone before the assertion
        // and would prove nothing about what the pass leaves alone.
        let first: i64 = conn
            .query_row("SELECT id FROM tracks WHERE track_no = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        tags::write::apply_to_each(
            &mut conn,
            &[first],
            &TagEdit {
                genre: Some("Dreampop".to_owned()),
                ..TagEdit::default()
            },
            |_| {},
        )
        .unwrap();

        let verdict = look_up(
            &mut conn,
            &musicbrainz(),
            &ScanLock::default(),
            &loveless(),
            dir.path(),
            false,
            100,
        )
        .unwrap();
        // Or the assertions below would hold over a pass that wrote nothing.
        assert!(matches!(verdict, Verdict::Written { .. }), "{verdict:?}");

        let genres: Vec<Option<String>> = conn
            .prepare("SELECT genre FROM tracks ORDER BY track_no")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            genres[0].as_deref(),
            Some("Dreampop"),
            "a hand-tagged genre stands"
        );
        assert_eq!(
            genres[1].as_deref(),
            Some("shoegaze"),
            "and an empty one is filled"
        );
    }

    #[test]
    fn a_comment_is_never_touched() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        let mut conn = db.conn().unwrap();
        let ids: Vec<i64> = conn
            .prepare("SELECT id FROM tracks ORDER BY track_no")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();

        // Onto the files, not just the rows: a comment only in the row would
        // prove nothing about what the write leaves alone.
        tags::write::apply_to_each(
            &mut conn,
            &ids,
            &TagEdit {
                comment: Some("ripped by me".to_owned()),
                ..TagEdit::default()
            },
            |_| {},
        )
        .unwrap();

        let verdict = look_up(
            &mut conn,
            &musicbrainz(),
            &ScanLock::default(),
            &loveless(),
            dir.path(),
            false,
            100,
        )
        .unwrap();
        // Or this would hold over a pass that wrote nothing at all.
        assert!(matches!(verdict, Verdict::Written { .. }), "{verdict:?}");
        assert_eq!(titles(&conn)[0].as_deref(), Some("Only Shallow"));

        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM tracks WHERE comment = 'ripped by me'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            11
        );
    }

    /// Above the bar the premise is that the track count agrees. It can clear
    /// the bar without agreeing - a perfect text match with ten of eleven
    /// tracks does - and mapping by position would then put ten titles on the
    /// wrong files.
    #[test]
    fn a_tracklist_of_a_different_length_is_queued_rather_than_mapped() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS[..10]);
        let mut conn = db.conn().unwrap();

        let verdict = look_up(
            &mut conn,
            &musicbrainz(),
            &ScanLock::default(),
            &loveless(),
            dir.path(),
            false,
            100,
        )
        .unwrap();

        assert!(matches!(verdict, Verdict::Queued { .. }), "{verdict:?}");
        assert_eq!(untitled(&conn), 0);
    }

    /// What the threshold is tuned with: the verdict without the consequence.
    #[test]
    fn a_dry_run_writes_neither_the_files_nor_a_row() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        let mut conn = db.conn().unwrap();

        let verdict = look_up(
            &mut conn,
            &musicbrainz(),
            &ScanLock::default(),
            &loveless(),
            dir.path(),
            true,
            100,
        )
        .unwrap();

        assert!(
            matches!(verdict, Verdict::Written { .. }),
            "it reports what it would do: {verdict:?}"
        );
        assert_eq!(untitled(&conn), 0);
        assert_eq!(
            conn.query_row("SELECT count(*) FROM release_lookup", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0,
            "a dry run leaves no row, or a second dry run would find nothing to do"
        );
    }
}
