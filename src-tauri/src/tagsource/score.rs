//! How well a candidate release fits the files on disk.
//!
//! Scored even though a human confirms every apply, because
//! [82](../../../docs/issues/upcoming/82b-the-unattended-lookup-pass.md) runs the same
//! lookup with nobody watching and needs a number to decide on. A score
//! invented later would be a different rule from the one the dialog sorted by.
//!
//! Three ingredients, in the order they become available: MusicBrainz's own
//! search score, which is textual and says nothing about the audio; the track
//! count, which is in the search result; and per-track durations, which are
//! not - a tracklist costs a second request, so the durations only join the
//! score once a candidate has been fetched.

/// The release as it exists on disk: every file sharing the album and artist,
/// not only the ones that were selected.
///
/// The whole release rather than the selection, because three files out of
/// twelve would otherwise score every twelve-track candidate as a mismatch and
/// prefer whichever obscure single happens to have three tracks.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LocalRelease {
    pub track_count: u32,
    /// Durations in track order, the same order the dialog maps in. Empty
    /// where nothing has been read yet, which is what makes the duration half
    /// optional rather than assumed.
    pub durations_ms: Vec<i64>,
}

/// A duration difference this small is agreement.
///
/// Encoders disagree by a frame or two, gapless rips shift a moment of silence
/// between tracks, and MusicBrainz's own lengths are rounded to the second.
const EXACT_MS: i64 = 2_000;

/// A duration difference this large is disagreement, with a slope between.
///
/// Half a minute is more than any of the above and less than a different
/// mix of the same song.
const TOLERANCE_MS: i64 = 30_000;

/// What each ingredient is worth once the durations are known.
const WITH_DURATIONS: (f32, f32, f32) = (0.45, 0.25, 0.30);
/// And before they are, where the two that remain carry the whole score.
const WITHOUT_DURATIONS: (f32, f32) = (0.6, 0.4);

/// The score a search result gets, from the text match and the track count.
pub fn score_without_durations(
    musicbrainz_score: u32,
    remote_track_count: u32,
    local: &LocalRelease,
) -> f32 {
    let (text_weight, count_weight) = WITHOUT_DURATIONS;
    text_weight * text_agreement(musicbrainz_score)
        + count_weight * count_agreement(remote_track_count, local.track_count)
}

/// The score a fetched release gets, once its tracklist is in hand.
pub fn score_with_durations(
    musicbrainz_score: u32,
    remote_track_count: u32,
    remote_durations: &[Option<i64>],
    local: &LocalRelease,
) -> f32 {
    let Some(durations) = duration_agreement(remote_durations, &local.durations_ms) else {
        // Nothing to compare - a release with no lengths, or files that have
        // not been read. Falling back keeps the two scores on one scale
        // instead of punishing a candidate for what is missing on the far end.
        return score_without_durations(musicbrainz_score, remote_track_count, local);
    };
    let (text_weight, count_weight, duration_weight) = WITH_DURATIONS;
    text_weight * text_agreement(musicbrainz_score)
        + count_weight * count_agreement(remote_track_count, local.track_count)
        + duration_weight * durations
}

/// MusicBrainz's search score is already 0 to 100.
fn text_agreement(musicbrainz_score: u32) -> f32 {
    (musicbrainz_score.min(100) as f32) / 100.0
}

/// One when the counts match, falling off with the size of the disagreement
/// relative to the larger of the two - so one missing track out of twelve
/// costs far less than one out of two.
fn count_agreement(remote: u32, local: u32) -> f32 {
    if remote == local {
        return 1.0;
    }
    let larger = remote.max(local);
    if larger == 0 {
        return 0.0;
    }
    1.0 - (remote.abs_diff(local) as f32 / larger as f32)
}

/// How well the two tracklists agree on how long each track is.
///
/// Position by position in track order, which is the mapping the dialog offers
/// and therefore the one being scored - a score computed over some other
/// pairing would be measuring an apply that never happens.
///
/// `None` when there is no pair to compare, which is different from a
/// comparison that came out at zero.
fn duration_agreement(remote: &[Option<i64>], local: &[i64]) -> Option<f32> {
    let pairs: Vec<(i64, i64)> = remote
        .iter()
        .zip(local)
        .filter_map(|(remote, local)| remote.map(|remote| (remote, *local)))
        .collect();
    if pairs.is_empty() {
        return None;
    }

    let total: f32 = pairs
        .iter()
        .map(|(remote, local)| {
            let difference = remote.abs_diff(*local) as i64;
            if difference <= EXACT_MS {
                1.0
            } else if difference >= TOLERANCE_MS {
                0.0
            } else {
                1.0 - ((difference - EXACT_MS) as f32 / (TOLERANCE_MS - EXACT_MS) as f32)
            }
        })
        .sum();

    // Averaged over the longer list, not over the pairs: a candidate that
    // matches three of twelve tracks perfectly is not a perfect match.
    let considered = remote.len().max(local.len()).max(1);
    Some(total / considered as f32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local(track_count: u32, durations_ms: &[i64]) -> LocalRelease {
        LocalRelease {
            track_count,
            durations_ms: durations_ms.to_vec(),
        }
    }

    #[test]
    fn a_perfect_text_match_with_the_right_track_count_scores_one() {
        assert_eq!(score_without_durations(100, 11, &local(11, &[])), 1.0);
    }

    #[test]
    fn the_wrong_number_of_tracks_costs_in_proportion_to_the_release() {
        let one_of_twelve = score_without_durations(100, 12, &local(11, &[]));
        let one_of_two = score_without_durations(100, 2, &local(1, &[]));
        assert!(
            one_of_twelve > one_of_two,
            "a missing track out of twelve is a smaller doubt than one out of two"
        );
    }

    #[test]
    fn durations_within_a_couple_of_seconds_count_as_agreement() {
        let remote = [Some(268_000), Some(200_000)];
        assert_eq!(
            score_with_durations(100, 2, &remote, &local(2, &[269_500, 199_000])),
            1.0
        );
    }

    /// The case the durations exist for: two pressings with the same title,
    /// the same artist and the same track count, one of which is the files.
    #[test]
    fn durations_separate_two_pressings_the_text_cannot() {
        let files = local(2, &[268_000, 200_000]);
        let same = score_with_durations(100, 2, &[Some(268_000), Some(200_000)], &files);
        let remixed = score_with_durations(100, 2, &[Some(400_000), Some(330_000)], &files);

        assert!(same > remixed);
        assert_eq!(same, 1.0);
    }

    #[test]
    fn a_release_with_no_lengths_is_scored_on_what_there_is() {
        let files = local(2, &[268_000, 200_000]);
        assert_eq!(
            score_with_durations(90, 2, &[None, None], &files),
            score_without_durations(90, 2, &files),
            "a candidate is not punished for MusicBrainz not knowing its lengths"
        );
    }

    #[test]
    fn matching_a_few_tracks_of_many_is_not_a_perfect_match() {
        let remote = [Some(268_000), Some(200_000), Some(180_000), Some(240_000)];
        let agreement = duration_agreement(&remote, &[268_000, 200_000]).unwrap();
        assert!(agreement > 0.4 && agreement < 0.6);
    }

    #[test]
    fn nothing_to_compare_is_not_a_disagreement() {
        assert_eq!(duration_agreement(&[], &[268_000]), None);
        assert_eq!(duration_agreement(&[Some(268_000)], &[]), None);
        assert_eq!(duration_agreement(&[None], &[268_000]), None);
    }

    #[test]
    fn every_score_stays_inside_the_scale_the_dialog_shows() {
        for musicbrainz in [0, 50, 100, 4_000] {
            for remote in [0_u32, 1, 11, 40] {
                let score = score_with_durations(
                    musicbrainz,
                    remote,
                    &[Some(1), Some(600_000)],
                    &local(11, &[268_000, 200_000]),
                );
                assert!((0.0..=1.0).contains(&score), "{score} is off the scale");
            }
        }
    }
}
