//! The Cover Art Archive, keyed by the release MusicBrainz already named.
//!
//! No auth and, unlike MusicBrainz, **no rate limit** - which is the only
//! reason a cover can be fetched at the same time as the tracklist rather than
//! a second after it. Nothing here touches
//! [`crate::tagsource::rate`], and that is deliberate.

use crate::error::AppResult;
use crate::tagsource::transport::Transport;

pub const ARCHIVE_ROOT: &str = "https://coverartarchive.org";

/// The size the covers table stores anyway, so a larger fetch would be
/// downscaled on arrival and the bytes in between wasted.
const SIZE: &str = "front-500";

/// The front cover of a release, or `None` when the archive has none.
///
/// A 404 is the ordinary answer for most releases in the archive and is not an
/// error: a release with no cover is still a release worth tagging from.
///
/// A transport failure is `None` too, for the same reason one step up: the
/// tracklist is what the lookup is for, and a cover that could not be fetched
/// must not take the release down with it.
pub fn front(transport: &dyn Transport, mbid: &str) -> AppResult<Option<Vec<u8>>> {
    Ok(transport
        .get(&format!("{ARCHIVE_ROOT}/release/{mbid}/{SIZE}"), &[])
        .unwrap_or(None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tagsource::transport::{FakeTransport, TransportError};

    const MBID: &str = "bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9";

    #[test]
    fn a_cover_is_asked_for_at_the_size_the_library_stores() {
        let transport =
            FakeTransport::new().answering_bytes("coverartarchive.org", b"\xff\xd8\xffjpeg");

        assert_eq!(
            front(&transport, MBID).unwrap(),
            Some(b"\xff\xd8\xffjpeg".to_vec())
        );
        assert_eq!(
            transport.call_to("coverartarchive.org").unwrap().url,
            format!("https://coverartarchive.org/release/{MBID}/front-500")
        );
    }

    #[test]
    fn a_release_with_no_cover_is_not_an_error() {
        let transport = FakeTransport::new().missing("coverartarchive.org");
        assert_eq!(front(&transport, MBID).unwrap(), None);
    }

    /// The archive being down is not a reason to refuse a tracklist.
    #[test]
    fn an_unreachable_archive_is_the_same_as_no_cover() {
        let transport = FakeTransport::new().failing(
            "coverartarchive.org",
            TransportError::Unreachable {
                host: "coverartarchive.org".to_owned(),
                message: "refused".to_owned(),
            },
        );

        assert_eq!(front(&transport, MBID).unwrap(), None);
    }
}
