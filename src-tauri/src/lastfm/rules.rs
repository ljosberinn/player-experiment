//! Whether a play is worth sending, and what to send.
//!
//! Pure, and separate from the service, because these are product judgements
//! rather than protocol: a track with no artist tag is not a scrobble anyone
//! wants, and neither is a two-second interlude.
//!
//! **What is not here is the 50% trigger.** That lives in `audio::engine` as
//! `PLAYED_FRACTION`, behind both play counts and scrobbling, so the two can
//! never disagree about what "played" means. By the time a track reaches this
//! module it has already been played; the only question left is whether
//! last.fm should hear about it.

use crate::model::Track;

/// Shorter than this and a play is not reported.
///
/// last.fm's own guidance pairs "half the track" with "or four minutes,
/// whichever comes first". **The four-minute cap is not adopted** - an
/// hour-long mix scrobbles at thirty minutes here - because adopting it would
/// mean a second definition of "played" beside the one the play count uses.
/// The floor has no such conflict: it costs nothing, it matches what other
/// clients do, and nobody means to scrobble a sound effect.
pub const MINIMUM_DURATION_MS: i64 = 30_000;

/// One play, in the terms the API takes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scrobble {
    pub artist: String,
    pub title: String,
    pub album: Option<String>,
    /// Milliseconds; converted to whole seconds at the wire.
    pub duration_ms: i64,
    /// Unix seconds at which the track started. Meaningless for now-playing,
    /// which describes the present, and unused there.
    pub started_at: i64,
}

impl Scrobble {
    /// Whole seconds, which is the unit last.fm's `duration` takes.
    pub fn duration_seconds(&self) -> i64 {
        self.duration_ms / 1000
    }
}

/// What to send for this play, or nothing.
///
/// `None` is the ordinary answer for a badly tagged library and is not an
/// error: the play still counted locally, and there is nothing to tell the
/// user about a track last.fm could not have matched anyway.
pub fn scrobbleable(track: &Track, started_at: i64) -> Option<Scrobble> {
    // Both are mandatory in the API and both are routinely absent from a file.
    let artist = non_empty(track.artist.as_deref())?;
    let title = non_empty(track.title.as_deref())?;

    if track.duration_ms < MINIMUM_DURATION_MS {
        return None;
    }
    // A timestamp of zero is what an unset clock looks like, and last.fm
    // rejects a play from 1970 with ignore code 3 rather than accepting it.
    if started_at <= 0 {
        return None;
    }

    Some(Scrobble {
        artist,
        title,
        album: non_empty(track.album.as_deref()),
        duration_ms: track.duration_ms,
        started_at,
    })
}

/// A tag with something in it, trimmed.
///
/// A whitespace-only artist is what a tag editor leaves behind, and it is not
/// a name - sending it would put a blank artist on the user's profile.
fn non_empty(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track() -> Track {
        Track {
            id: 1,
            path: "C:\\music\\1.mp3".to_owned(),
            duration_ms: 240_000,
            title: Some("Harbour".to_owned()),
            artist: Some("Blue Room".to_owned()),
            album: Some("Coastline".to_owned()),
            album_artist: None,
            genre: None,
            year: None,
            track_no: None,
            disc_no: None,
            comment: None,
            bitrate: None,
            sample_rate: None,
            cover_hash: None,
            added_at: 0,
            play_count: 0,
            last_played_at: None,
            missing_since: None,
        }
    }

    #[test]
    fn a_well_tagged_play_is_worth_sending() {
        let scrobble = scrobbleable(&track(), 1_700_000_000).unwrap();

        assert_eq!(
            scrobble,
            Scrobble {
                artist: "Blue Room".to_owned(),
                title: "Harbour".to_owned(),
                album: Some("Coastline".to_owned()),
                duration_ms: 240_000,
                started_at: 1_700_000_000,
            }
        );
        assert_eq!(scrobble.duration_seconds(), 240);
    }

    #[test]
    fn the_two_mandatory_tags_are_mandatory() {
        for missing in [
            Track {
                artist: None,
                ..track()
            },
            Track {
                title: None,
                ..track()
            },
            // What a tag editor leaves behind, and not a name.
            Track {
                artist: Some("   ".to_owned()),
                ..track()
            },
            Track {
                title: Some("\t".to_owned()),
                ..track()
            },
        ] {
            assert_eq!(scrobbleable(&missing, 1_700_000_000), None);
        }
    }

    #[test]
    fn tags_are_trimmed_rather_than_sent_as_written() {
        let padded = Track {
            artist: Some("  Blue Room ".to_owned()),
            title: Some(" Harbour".to_owned()),
            ..track()
        };
        let scrobble = scrobbleable(&padded, 1).unwrap();
        assert_eq!(scrobble.artist, "Blue Room");
        assert_eq!(scrobble.title, "Harbour");
    }

    #[test]
    fn a_missing_album_is_absent_rather_than_blank() {
        for blank in [None, Some(String::new()), Some("  ".to_owned())] {
            let scrobble = scrobbleable(
                &Track {
                    album: blank,
                    ..track()
                },
                1,
            )
            .unwrap();
            assert_eq!(scrobble.album, None);
        }
    }

    #[test]
    fn the_thirty_second_floor_is_exact() {
        let short = |duration_ms| Track {
            duration_ms,
            ..track()
        };

        assert_eq!(scrobbleable(&short(29_999), 1), None);
        assert!(scrobbleable(&short(30_000), 1).is_some());
    }

    #[test]
    fn an_hour_long_mix_is_still_a_scrobble() {
        // The four-minute cap is deliberately not adopted; this is the case
        // that would behave differently if it ever were, and the engine's
        // `PLAYED_FRACTION` is the reason it is not.
        assert!(scrobbleable(
            &Track {
                duration_ms: 3_600_000,
                ..track()
            },
            1_700_000_000
        )
        .is_some());
    }

    #[test]
    fn a_play_with_no_timestamp_is_not_sent() {
        // last.fm answers a play dated 1970 with ignore code 3, so the choice
        // is between sending something that will be thrown away and not
        // sending it.
        assert_eq!(scrobbleable(&track(), 0), None);
        assert_eq!(scrobbleable(&track(), -1), None);
    }

    #[test]
    fn a_track_of_unknown_length_is_never_scrobbled() {
        // The engine never counts one as played either, so this is belt and
        // braces - and the rule that makes it true here is the floor rather
        // than a special case.
        assert_eq!(
            scrobbleable(
                &Track {
                    duration_ms: 0,
                    ..track()
                },
                1_700_000_000
            ),
            None
        );
    }
}
