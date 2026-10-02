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
pub mod pass;
pub mod rate;
pub mod score;
pub mod transport;

use crate::error::{AppError, AppResult};
use crate::log::Fields;
use crate::model::ReleaseDetail;
use crate::tagsource::score::LocalRelease;
use crate::tagsource::transport::Transport;

/// How many times a request that could work later is asked again.
pub const RETRIES: usize = 2;

/// Runs `call`, asking again on a failure `worth` says could work later,
/// counting the times it had to into `asked_again`.
///
/// No waiting of its own: every attempt goes through [`rate`], which already
/// holds the next request back by its whole interval, so a second backoff here
/// would only be two things deciding the same thing and disagreeing.
///
/// The caller decides what is worth asking again, because the two callers
/// differ in who is waiting. The pass asks again on anything
/// [`AppError::transient`]; a dialog only on [`AppError::declined`], since a
/// timeout asked again three times is most of a minute of "Searching…".
///
/// The count is the only sign a retry leaves. One that works is invisible
/// otherwise - the release resolves, and the interval it cost looks like a
/// slow request rather than a 503 that was absorbed.
pub fn retrying<T>(
    asked_again: &mut usize,
    worth: impl Fn(&AppError) -> bool,
    mut call: impl FnMut() -> AppResult<T>,
) -> AppResult<T> {
    for _ in 0..RETRIES {
        match call() {
            Err(error) if worth(&error) => *asked_again += 1,
            result => return result,
        }
    }
    call()
}

/// `retries=` on a lookup's line, only when there were some: there almost
/// never are, and a `retries=0` on eight thousand lines says nothing.
pub fn with_retries(fields: Fields, retries: usize) -> Fields {
    if retries > 0 {
        fields.add("retries", retries)
    } else {
        fields
    }
}

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
pub(crate) mod tests {
    use super::*;
    use crate::tagsource::transport::{FakeTransport, Fetched, TransportError};

    /// A transport that refuses the first few requests and then answers.
    ///
    /// `FakeTransport` gives the same answer every time, so a retry that
    /// *works* is a case no fixture can express - and it is the case that
    /// matters, because it is the one that leaves no other trace.
    pub(crate) struct Flaky {
        refusals: std::sync::Mutex<usize>,
        then: FakeTransport,
    }

    /// `then`, behind `refusals` 503s.
    pub(crate) fn flaky(refusals: usize, then: FakeTransport) -> Flaky {
        Flaky {
            refusals: std::sync::Mutex::new(refusals),
            then,
        }
    }

    impl Transport for Flaky {
        fn get(&self, url: &str, params: &[(&str, String)]) -> Fetched {
            {
                let mut left = self.refusals.lock().unwrap();
                if *left > 0 {
                    *left -= 1;
                    return Err(TransportError::Server {
                        host: "musicbrainz.org".to_owned(),
                        status: 503,
                    });
                }
            }
            self.then.get(url, params)
        }
    }

    fn failing(error: TransportError) -> FakeTransport {
        FakeTransport::new().failing("/ws/2/release", error)
    }

    fn search(
        transport: &dyn Transport,
        asked_again: &mut usize,
        worth: fn(&AppError) -> bool,
    ) -> AppResult<Vec<crate::model::ReleaseCandidate>> {
        retrying(asked_again, worth, || {
            musicbrainz::search(transport, Some("Loveless"), None, &LocalRelease::default())
        })
    }

    #[test]
    fn a_retry_that_works_is_counted() {
        let transport = flaky(
            1,
            FakeTransport::new().answering("/ws/2/release", r#"{"releases":[]}"#),
        );
        let mut asked_again = 0;

        search(&transport, &mut asked_again, AppError::declined).unwrap();

        assert_eq!(asked_again, 1);
    }

    #[test]
    fn a_failure_worth_asking_again_is_asked_twice_more() {
        let transport = failing(TransportError::Server {
            host: "musicbrainz.org".to_owned(),
            status: 503,
        });
        let mut asked_again = 0;

        let error = search(&transport, &mut asked_again, AppError::declined).unwrap_err();

        assert!(error.declined(), "{error}");
        assert_eq!(transport.call_count(), RETRIES + 1);
        assert_eq!(asked_again, RETRIES, "a chain that ran out still counts");
    }

    /// The dialog's rule: a timeout is transient, and asked again three times
    /// it would hold "Searching…" for most of a minute.
    #[test]
    fn a_failure_the_caller_does_not_count_is_given_up_on_at_once() {
        let transport = failing(TransportError::Unreachable {
            host: "musicbrainz.org".to_owned(),
            message: "timed out".to_owned(),
        });
        let mut asked_again = 0;

        let error = search(&transport, &mut asked_again, AppError::declined).unwrap_err();

        assert!(
            error.transient(),
            "the pass would have asked again: {error}"
        );
        assert_eq!(transport.call_count(), 1);
        assert_eq!(asked_again, 0);
    }

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
