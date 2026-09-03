//! The one thing standing between this app and a blocked IP address.
//!
//! MusicBrainz enforces its limit at the address, not at the client, and
//! exceeding it gets the address blocked rather than throttled. So the limiter
//! is process-wide: a limiter owned by a client instance would let
//! [82](../../../docs/issues/upcoming/82-lookup-runs-itself.md)'s background
//! pass and an open dialog make two requests a second between them, each
//! believing it was the only caller.
//!
//! Only MusicBrainz goes through it. The Cover Art Archive has no rate limit,
//! which is what lets a cover fetch run beside a release fetch instead of
//! behind it.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// One request a second, which is what MusicBrainz allows an anonymous client.
const INTERVAL: Duration = Duration::from_secs(1);

/// A gate that lets one request through per interval.
pub struct Limiter {
    interval: Duration,
    /// When the last request was let through. The lock is held across the
    /// sleep on purpose: that is what makes two threads queue rather than both
    /// see the same stale instant and both go.
    last: Mutex<Option<Instant>>,
}

impl Limiter {
    pub const fn new(interval: Duration) -> Self {
        Self {
            interval,
            last: Mutex::new(None),
        }
    }

    /// Blocks until a request may be made, then records that one was.
    pub fn wait(&self) {
        let mut last = self
            .last
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(previous) = *last {
            let elapsed = previous.elapsed();
            if elapsed < self.interval {
                std::thread::sleep(self.interval - elapsed);
            }
        }
        // After the sleep rather than before it, so the next caller measures
        // from when this request actually went out.
        *last = Some(Instant::now());
    }
}

/// The limiter every MusicBrainz call goes through.
pub fn shared() -> &'static Limiter {
    static SHARED: Limiter = Limiter::new(INTERVAL);
    &SHARED
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_request_is_not_delayed() {
        let limiter = Limiter::new(Duration::from_millis(200));
        let started = Instant::now();
        limiter.wait();
        assert!(started.elapsed() < Duration::from_millis(100));
    }

    #[test]
    fn a_second_request_waits_out_the_interval() {
        let limiter = Limiter::new(Duration::from_millis(200));
        let started = Instant::now();
        limiter.wait();
        limiter.wait();
        assert!(started.elapsed() >= Duration::from_millis(200));
    }

    /// The case a per-client limiter gets wrong, and the reason this one is
    /// shared: two callers that never meet still have to queue behind each
    /// other, because the limit is enforced at the address they share.
    ///
    /// At the real one request a second, so what is asserted is the rule as it
    /// ships rather than a scaled-down imitation of it.
    #[test]
    fn two_callers_serialize_against_each_other() {
        let started = Instant::now();
        std::thread::scope(|scope| {
            for _ in 0..2 {
                scope.spawn(|| shared().wait());
            }
        });

        assert!(
            started.elapsed() >= INTERVAL,
            "two concurrent callers went through in {:?}, which is faster than one a second",
            started.elapsed()
        );
    }
}
