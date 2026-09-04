//! Where a release's tags come from when the files do not have them.
//!
//! **MusicBrainz, and only MusicBrainz.** Lidarr, Picard and beets are all on
//! it; Discogs is the secondary everyone reaches for on electronic and vinyl
//! and needs a mandatory token, a stored credential and a Settings control to
//! give a second opinion on records this library mostly is not.
//!
//! **No provider trait.** One implementation does not justify one, and a
//! second source is not planned - the seam that matters is
//! [`transport`], which is what lets everything above it be tested with no
//! network.
//!
//! Outbound network, and inert unless somebody asks for it: nothing in this
//! module runs on launch, on scan, or on play.

pub mod coverart;
pub mod musicbrainz;
pub mod rate;
pub mod score;
pub mod transport;

use crate::error::AppResult;
use crate::model::ReleaseDetail;
use crate::tagsource::score::LocalRelease;
use crate::tagsource::transport::Transport;

/// A release's tracklist and its cover, fetched at the same time.
///
/// At the same time on purpose. MusicBrainz allows one request a second and
/// the Cover Art Archive has no limit at all, so the cover is free as long as
/// it runs beside the release rather than after it - doing them in sequence
/// would add a whole rate-limited second to every pick.
///
/// The cover comes back as bytes rather than a path: staging is the caller's
/// business, because it is the caller that knows where this application's
/// cache directory is.
pub fn fetch_release(
    transport: &(dyn Transport + '_),
    mbid: &str,
    local: &LocalRelease,
) -> AppResult<(ReleaseDetail, Option<Vec<u8>>)> {
    std::thread::scope(|scope| {
        let cover = scope.spawn(|| coverart::front(transport, mbid));
        let detail = musicbrainz::fetch(transport, mbid, local)?;
        let cover = cover
            .join()
            .unwrap_or_else(|_| Ok(None))
            .unwrap_or_default();
        Ok((detail, cover))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tagsource::transport::FakeTransport;

    const MBID: &str = "bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9";
    const RELEASE_JSON: &str = include_str!("fixtures/release-loveless.json");

    #[test]
    fn a_release_and_its_cover_arrive_together() {
        let transport = FakeTransport::new()
            .answering("musicbrainz.org", RELEASE_JSON)
            .answering_bytes("coverartarchive.org", b"\xff\xd8\xffjpeg");

        let (detail, cover) = fetch_release(&transport, MBID, &LocalRelease::default()).unwrap();

        assert_eq!(detail.tracks.len(), 11);
        assert_eq!(cover, Some(b"\xff\xd8\xffjpeg".to_vec()));
        assert_eq!(transport.call_count(), 2);
    }

    #[test]
    fn a_release_with_no_cover_still_comes_back() {
        let transport = FakeTransport::new()
            .answering("musicbrainz.org", RELEASE_JSON)
            .missing("coverartarchive.org");

        let (detail, cover) = fetch_release(&transport, MBID, &LocalRelease::default()).unwrap();

        assert_eq!(detail.tracks.len(), 11);
        assert_eq!(cover, None);
    }
}
