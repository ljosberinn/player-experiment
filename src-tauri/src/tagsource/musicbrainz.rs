//! MusicBrainz, and the two calls a release costs.
//!
//! `inc` is not accepted on a search, so there is no way to get a tracklist
//! and a search result in one request: [`search`] finds candidates, [`fetch`]
//! reads the tracklist of the one that was picked. Both go through
//! [`crate::tagsource::rate`], because the limit is enforced at the address
//! and every caller in this process shares one.
//!
//! Nothing here opens a socket - see [`crate::tagsource::transport`] - so the
//! query building, the parsing and the scoring below are all exercised against
//! recorded responses on a runner with no network.

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::model::{ReleaseCandidate, ReleaseDetail, RemoteTrack};
use crate::tagsource::score::{score_with_durations, score_without_durations, LocalRelease};
use crate::tagsource::transport::{Transport, TransportError};

/// Where the web service lives.
pub const API_ROOT: &str = "https://musicbrainz.org/ws/2";

/// What a release fetch asks to have included.
///
/// Spaces rather than the `+` the documentation shows: form encoding turns a
/// space into `+`, so the request that goes out is the canonical one and the
/// separator is not something this file has to encode by hand.
const RELEASE_INC: &str = "recordings artist-credits release-groups";

/// How many candidates a search asks for.
///
/// Enough that a reissue-heavy album still shows the pressing the files came
/// from, and few enough that the list is read rather than scrolled.
const SEARCH_LIMIT: usize = 15;

/// Turns a transport failure into something a person reads.
fn network(error: TransportError) -> AppError {
    AppError::Internal(error.to_string())
}

/// Escapes the characters Lucene would otherwise read as syntax.
///
/// The values come from tags, and tags contain brackets, colons and
/// exclamation marks - `Vol. 2 (Deluxe)` is a query error rather than a search
/// unless they are escaped.
fn lucene_escape(value: &str) -> String {
    const SPECIAL: &[char] = &[
        '\\', '+', '-', '&', '|', '!', '(', ')', '{', '}', '[', ']', '^', '"', '~', '*', '?', ':',
        '/',
    ];
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if SPECIAL.contains(&character) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

/// The Lucene query for an album and an artist, either of which may be absent.
///
/// Absent rather than empty is the untagged case, and searching for `release:""`
/// would ask MusicBrainz for releases with no title.
fn query_for(album: Option<&str>, artist: Option<&str>) -> AppResult<String> {
    let mut clauses = Vec::new();
    if let Some(album) = album.map(str::trim).filter(|value| !value.is_empty()) {
        clauses.push(format!("release:\"{}\"", lucene_escape(album)));
    }
    if let Some(artist) = artist.map(str::trim).filter(|value| !value.is_empty()) {
        clauses.push(format!("artist:\"{}\"", lucene_escape(artist)));
    }
    if clauses.is_empty() {
        return Err(AppError::Internal(
            "These songs name neither an album nor an artist, so there is nothing to look up."
                .to_owned(),
        ));
    }
    Ok(clauses.join(" AND "))
}

/// A MusicBrainz id, checked before it is put in a URL path.
///
/// The only value in this module that is interpolated rather than sent as a
/// parameter, so it is the only one that could reach outside the path it is
/// meant to name.
fn valid_mbid(mbid: &str) -> bool {
    mbid.len() == 36
        && mbid
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
}

/// Searches for releases matching an album and artist, best match first.
pub fn search(
    transport: &dyn Transport,
    album: Option<&str>,
    artist: Option<&str>,
    local: &LocalRelease,
) -> AppResult<Vec<ReleaseCandidate>> {
    let query = query_for(album, artist)?;
    crate::tagsource::rate::shared().wait();

    let body = transport
        .get(
            &format!("{API_ROOT}/release"),
            &[
                ("query", query),
                ("fmt", "json".to_owned()),
                ("limit", SEARCH_LIMIT.to_string()),
            ],
        )
        .map_err(network)?
        // A search cannot 404: an empty result is `{"releases":[]}` with a
        // 200, so nothing to find and nothing there are the same answer.
        .ok_or_else(|| AppError::Internal("MusicBrainz has no search endpoint here.".to_owned()))?;

    let response: SearchResponse = serde_json::from_slice(&body)
        .map_err(|e| AppError::Internal(format!("MusicBrainz sent something unreadable: {e}")))?;

    let mut candidates: Vec<ReleaseCandidate> = response
        .releases
        .into_iter()
        .map(|release| release.into_candidate(local))
        .collect();
    // Descending, and `total_cmp` because a score is an f32: `partial_cmp`
    // would need an unwrap that a NaN could reach.
    candidates.sort_by(|left, right| right.score.total_cmp(&left.score));
    Ok(candidates)
}

/// Reads one release's tracklist.
///
/// The score is recomputed here rather than carried over from the search,
/// because this is the first point at which the per-track durations exist -
/// and they are the half of the score that tells two pressings apart.
pub fn fetch(
    transport: &dyn Transport,
    mbid: &str,
    local: &LocalRelease,
) -> AppResult<ReleaseDetail> {
    if !valid_mbid(mbid) {
        return Err(AppError::Internal(format!(
            "{mbid} is not a MusicBrainz id."
        )));
    }
    crate::tagsource::rate::shared().wait();

    let body = transport
        .get(
            &format!("{API_ROOT}/release/{mbid}"),
            &[("inc", RELEASE_INC.to_owned()), ("fmt", "json".to_owned())],
        )
        .map_err(network)?
        .ok_or_else(|| AppError::NotFound(format!("MusicBrainz has no release {mbid}.")))?;

    let response: ReleaseResponse = serde_json::from_slice(&body)
        .map_err(|e| AppError::Internal(format!("MusicBrainz sent something unreadable: {e}")))?;

    Ok(response.into_detail(local))
}

/// One artist credited on a release or a track.
///
/// A credit is a list, not a name: "Simon & Garfunkel" is one artist and
/// "Danger Mouse feat. Norah Jones" is two joined by a phrase, and rebuilding
/// the phrase is the only way to get the string the file should carry.
#[derive(Debug, Deserialize)]
struct ArtistCredit {
    #[serde(default)]
    name: String,
    #[serde(default)]
    joinphrase: String,
}

fn credited(credits: &[ArtistCredit]) -> String {
    credits
        .iter()
        .map(|credit| format!("{}{}", credit.name, credit.joinphrase))
        .collect::<String>()
        .trim()
        .to_owned()
}

#[derive(Debug, Deserialize)]
struct ReleaseGroup {
    id: String,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    releases: Vec<SearchRelease>,
}

#[derive(Debug, Deserialize)]
struct SearchRelease {
    id: String,
    #[serde(default)]
    score: u32,
    #[serde(default)]
    title: String,
    date: Option<String>,
    country: Option<String>,
    #[serde(rename = "artist-credit", default)]
    artist_credit: Vec<ArtistCredit>,
    #[serde(rename = "release-group")]
    release_group: Option<ReleaseGroup>,
    #[serde(rename = "track-count")]
    track_count: Option<u32>,
    #[serde(default)]
    media: Vec<SearchMedium>,
}

/// A medium as a *search* result describes it: how many discs of this format
/// and how many tracks on them, with no tracklist. The fetch's `media` is a
/// different shape, which is why it is a different type.
#[derive(Debug, Deserialize)]
struct SearchMedium {
    format: Option<String>,
    #[serde(rename = "disc-count")]
    disc_count: Option<u32>,
    #[serde(rename = "track-count")]
    track_count: Option<u32>,
}

impl SearchRelease {
    fn into_candidate(self, local: &LocalRelease) -> ReleaseCandidate {
        let track_count = self.track_count.unwrap_or_else(|| {
            self.media
                .iter()
                .filter_map(|medium| medium.track_count)
                .sum()
        });
        let disc_count = self
            .media
            .iter()
            .map(|medium| medium.disc_count.unwrap_or(1))
            .sum::<u32>()
            .max(1);

        ReleaseCandidate {
            score: score_without_durations(self.score, track_count, local),
            mbid: self.id,
            release_group_mbid: self.release_group.map(|group| group.id),
            title: self.title,
            artist: credited(&self.artist_credit),
            date: self.date,
            country: self.country,
            // The first format, not all of them: a two-disc CD and a
            // CD-plus-DVD both read as "CD" here, and the disc count beside it
            // is what says how many.
            format: self.media.into_iter().find_map(|medium| medium.format),
            track_count,
            disc_count,
        }
    }
}

#[derive(Debug, Deserialize)]
struct ReleaseResponse {
    id: String,
    #[serde(default)]
    title: String,
    date: Option<String>,
    country: Option<String>,
    #[serde(rename = "artist-credit", default)]
    artist_credit: Vec<ArtistCredit>,
    #[serde(rename = "release-group")]
    release_group: Option<ReleaseGroup>,
    #[serde(default)]
    media: Vec<Medium>,
}

#[derive(Debug, Deserialize)]
struct Medium {
    position: Option<i64>,
    format: Option<String>,
    #[serde(default)]
    tracks: Vec<MediumTrack>,
}

#[derive(Debug, Deserialize)]
struct MediumTrack {
    position: Option<i64>,
    title: Option<String>,
    length: Option<i64>,
    #[serde(rename = "artist-credit", default)]
    artist_credit: Vec<ArtistCredit>,
    recording: Option<Recording>,
}

/// The recording behind a track, which is where the title and the length live
/// when the track itself carries neither - a release that does not rename its
/// tracks stores them once, on the recording.
#[derive(Debug, Deserialize)]
struct Recording {
    title: Option<String>,
    length: Option<i64>,
    #[serde(rename = "artist-credit", default)]
    artist_credit: Vec<ArtistCredit>,
}

impl ReleaseResponse {
    fn into_detail(self, local: &LocalRelease) -> ReleaseDetail {
        let album_artist = credited(&self.artist_credit);
        let format = self.media.iter().find_map(|medium| medium.format.clone());
        let disc_count = u32::try_from(self.media.len()).unwrap_or(u32::MAX).max(1);

        let mut tracks: Vec<RemoteTrack> = Vec::new();
        for (index, medium) in self.media.into_iter().enumerate() {
            // `position` is one-based and authoritative for multi-disc
            // releases; the index is the fallback for a release that omits it.
            let disc_no = medium
                .position
                .unwrap_or_else(|| i64::try_from(index).unwrap_or(0) + 1);
            for (offset, track) in medium.tracks.into_iter().enumerate() {
                let recording = track.recording;
                // `position` rather than `number`, which is a string and is
                // "A1" on a vinyl release - a track number is an integer here
                // and there is nothing sensible to parse that into.
                let track_no = track
                    .position
                    .unwrap_or_else(|| i64::try_from(offset).unwrap_or(0) + 1);
                let artist = match credited(&track.artist_credit) {
                    credit if !credit.is_empty() => credit,
                    _ => recording
                        .as_ref()
                        .map(|recording| credited(&recording.artist_credit))
                        .unwrap_or_default(),
                };
                tracks.push(RemoteTrack {
                    title: track
                        .title
                        .or_else(|| recording.as_ref().and_then(|r| r.title.clone()))
                        .unwrap_or_default(),
                    artist: if artist.is_empty() {
                        album_artist.clone()
                    } else {
                        artist
                    },
                    track_no,
                    disc_no,
                    duration_ms: track
                        .length
                        .or_else(|| recording.as_ref().and_then(|r| r.length)),
                });
            }
        }

        let track_count = u32::try_from(tracks.len()).unwrap_or(u32::MAX);
        let durations: Vec<Option<i64>> = tracks.iter().map(|track| track.duration_ms).collect();

        ReleaseDetail {
            candidate: ReleaseCandidate {
                // The search score is not in this response, and a fetch is
                // only ever made for a candidate the search already scored -
                // so the ceiling is what a perfect textual match would have
                // been, and the durations decide the rest.
                score: score_with_durations(100, track_count, &durations, local),
                mbid: self.id,
                release_group_mbid: self.release_group.map(|group| group.id),
                title: self.title,
                artist: album_artist.clone(),
                date: self.date.clone(),
                country: self.country,
                format,
                track_count,
                disc_count,
            },
            year: self.date.as_deref().and_then(year_of),
            album_artist,
            tracks,
            cover_path: None,
        }
    }
}

/// The year out of a MusicBrainz date, which is `1991`, `1991-11` or
/// `1991-11-04` depending on how much is known.
fn year_of(date: &str) -> Option<i64> {
    let digits: String = date.chars().take_while(char::is_ascii_digit).collect();
    (digits.len() == 4).then(|| digits.parse().ok()).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tagsource::transport::FakeTransport;

    fn local(count: u32) -> LocalRelease {
        LocalRelease {
            track_count: count,
            durations_ms: Vec::new(),
        }
    }

    const SEARCH_JSON: &str = include_str!("fixtures/search-loveless.json");
    const RELEASE_JSON: &str = include_str!("fixtures/release-loveless.json");
    const MULTI_DISC_JSON: &str = include_str!("fixtures/release-multi-disc.json");
    const VARIOUS_JSON: &str = include_str!("fixtures/release-various-artists.json");

    #[test]
    fn tag_values_that_look_like_query_syntax_are_escaped() {
        assert_eq!(lucene_escape("Vol. 2 (Deluxe)"), r"Vol. 2 \(Deluxe\)");
        assert_eq!(lucene_escape("AC/DC"), r"AC\/DC");
        assert_eq!(lucene_escape("!!!"), r"\!\!\!");
        assert_eq!(lucene_escape("plain"), "plain");
    }

    #[test]
    fn a_query_names_whichever_of_the_two_tags_the_files_carry() {
        assert_eq!(
            query_for(Some("Loveless"), Some("My Bloody Valentine")).unwrap(),
            r#"release:"Loveless" AND artist:"My Bloody Valentine""#
        );
        assert_eq!(
            query_for(Some("Loveless"), None).unwrap(),
            r#"release:"Loveless""#
        );
        assert_eq!(
            query_for(None, Some("My Bloody Valentine")).unwrap(),
            r#"artist:"My Bloody Valentine""#
        );
        assert_eq!(
            query_for(Some("   "), None).unwrap_err().to_string(),
            "These songs name neither an album nor an artist, so there is nothing to look up."
        );
    }

    #[test]
    fn only_something_shaped_like_an_id_reaches_the_url() {
        assert!(valid_mbid("bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9"));
        assert!(!valid_mbid("../../release"));
        assert!(!valid_mbid("bb5a3a25"));
    }

    #[test]
    fn a_search_asks_for_json_and_sends_the_query_as_a_parameter() {
        let transport = FakeTransport::new().answering("/ws/2/release", SEARCH_JSON);

        search(
            &transport,
            Some("Loveless"),
            Some("My Bloody Valentine"),
            &local(11),
        )
        .unwrap();

        let call = transport.call_to("/ws/2/release").unwrap();
        assert_eq!(call.param("fmt"), Some("json"));
        assert_eq!(
            call.param("query"),
            Some(r#"release:"Loveless" AND artist:"My Bloody Valentine""#),
            "the query is a parameter, so the transport encodes it"
        );
    }

    #[test]
    fn a_search_reads_the_fields_a_result_list_shows() {
        let transport = FakeTransport::new().answering("/ws/2/release", SEARCH_JSON);
        let candidates = search(&transport, Some("Loveless"), None, &local(11)).unwrap();

        assert_eq!(candidates.len(), 3);
        let first = &candidates[0];
        assert_eq!(first.mbid, "bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9");
        assert_eq!(first.title, "Loveless");
        assert_eq!(first.artist, "My Bloody Valentine");
        assert_eq!(first.date.as_deref(), Some("1991-11-04"));
        assert_eq!(first.country.as_deref(), Some("GB"));
        assert_eq!(first.format.as_deref(), Some("CD"));
        assert_eq!(first.track_count, 11);
        assert_eq!(first.disc_count, 1);
        assert_eq!(
            first.release_group_mbid.as_deref(),
            Some("2c7d1b1a-1a1a-4c4c-8f8f-9a9a9a9a9a9a")
        );
    }

    /// The whole reason a score exists: the textually perfect match with the
    /// wrong number of tracks has to lose to the one that fits the files.
    #[test]
    fn candidates_are_ordered_by_how_well_they_fit_the_files() {
        let transport = FakeTransport::new().answering("/ws/2/release", SEARCH_JSON);

        let for_eleven = search(&transport, Some("Loveless"), None, &local(11)).unwrap();
        assert_eq!(for_eleven[0].track_count, 11);

        let for_twenty_two = search(&transport, Some("Loveless"), None, &local(22)).unwrap();
        assert_eq!(
            for_twenty_two[0].track_count, 22,
            "a 22-file release should prefer the two-disc reissue"
        );
    }

    #[test]
    fn a_fetch_asks_for_the_tracklist_and_reads_it() {
        let transport = FakeTransport::new().answering("/ws/2/release/", RELEASE_JSON);
        let detail = fetch(
            &transport,
            "bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9",
            &local(11),
        )
        .unwrap();

        let call = transport.call_to("/ws/2/release/").unwrap();
        assert_eq!(
            call.param("inc"),
            Some("recordings artist-credits release-groups"),
            "one call has to bring the tracklist, the credits and the group"
        );

        assert_eq!(detail.album_artist, "My Bloody Valentine");
        assert_eq!(detail.year, Some(1991));
        assert_eq!(detail.tracks.len(), 11);
        assert_eq!(detail.tracks[0].title, "Only Shallow");
        assert_eq!(detail.tracks[0].track_no, 1);
        assert_eq!(detail.tracks[0].disc_no, 1);
        assert_eq!(detail.tracks[0].duration_ms, Some(268000));
        assert_eq!(
            detail.tracks[10].duration_ms, None,
            "a release MusicBrainz has no length for still has a tracklist"
        );
    }

    #[test]
    fn a_multi_disc_release_numbers_its_tracks_per_disc() {
        let transport = FakeTransport::new().answering("/ws/2/release/", MULTI_DISC_JSON);
        let detail = fetch(
            &transport,
            "aa5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9",
            &local(4),
        )
        .unwrap();

        assert_eq!(detail.candidate.disc_count, 2);
        assert_eq!(
            detail
                .tracks
                .iter()
                .map(|track| (track.disc_no, track.track_no))
                .collect::<Vec<_>>(),
            vec![(1, 1), (1, 2), (2, 1), (2, 2)]
        );
    }

    /// A compilation is the case where the release artist and the track artist
    /// are deliberately different, and a reader that takes one for the other
    /// writes "Various Artists" over eighteen real names.
    #[test]
    fn a_various_artists_release_keeps_each_track_its_own_artist() {
        let transport = FakeTransport::new().answering("/ws/2/release/", VARIOUS_JSON);
        let detail = fetch(
            &transport,
            "cc5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9",
            &local(3),
        )
        .unwrap();

        assert_eq!(detail.album_artist, "Various Artists");
        assert_eq!(
            detail
                .tracks
                .iter()
                .map(|track| track.artist.as_str())
                .collect::<Vec<_>>(),
            vec!["Aphex Twin", "Autechre", "µ-Ziq feat. Kid Spatula"]
        );
    }

    #[test]
    fn a_release_that_is_not_there_is_not_found_rather_than_broken() {
        let transport = FakeTransport::new().missing("/ws/2/release/");
        let error = fetch(
            &transport,
            "bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9",
            &local(11),
        )
        .expect_err("a 404 from the release endpoint means the id is wrong");

        assert!(matches!(error, AppError::NotFound(_)));
    }

    #[test]
    fn a_year_is_taken_off_whichever_shape_the_date_has() {
        assert_eq!(year_of("1991"), Some(1991));
        assert_eq!(year_of("1991-11"), Some(1991));
        assert_eq!(year_of("1991-11-04"), Some(1991));
        assert_eq!(year_of(""), None);
        assert_eq!(year_of("unknown"), None);
    }

    /// Not run by `cargo test`: it talks to MusicBrainz. It is here because a
    /// fixture is a recording of a response shape, and the shape is theirs to
    /// change - `cargo test -p apex -- --ignored` is how that is noticed.
    #[test]
    #[ignore = "talks to musicbrainz.org"]
    fn a_live_lookup_finds_a_release_and_its_tracklist() {
        let transport = crate::tagsource::transport::shared().expect("an HTTP client");
        let local = LocalRelease {
            track_count: 11,
            durations_ms: Vec::new(),
        };

        let candidates = search(
            transport,
            Some("Loveless"),
            Some("My Bloody Valentine"),
            &local,
        )
        .expect("a search");
        assert!(!candidates.is_empty());

        let detail = fetch(transport, &candidates[0].mbid, &local).expect("a tracklist");
        assert!(!detail.tracks.is_empty());
    }
}
