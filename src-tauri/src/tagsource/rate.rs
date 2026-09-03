//! The one thing standing between this app and a blocked IP address.
//!
//! MusicBrainz enforces its limit at the address, not at the client, and
//! exceeding it gets the address blocked rather than throttled. So the limiter
//! is process-wide: a limiter owned by a client instance would let
//! [82](../../../docs/issues/done/82b-the-unattended-lookup-pass.md)'s background
//! pass and an open dialog make two requests at once between them, each
//! believing it was the only caller.
//!
//! Only MusicBrainz goes through it. The Cover Art Archive has no rate limit,
//! which is what lets a cover fetch run beside a release fetch instead of
//! behind it - and it is why nothing inside a limited call ever takes the
//! limiter again, which would deadlock.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long the process waits between MusicBrainz requests.
///
/// Three seconds against a documented one per second per address, which is
/// deliberate rather than cautious. [Their
/// documentation](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)
/// declines with a 503 from three separate buckets - per user agent, per
/// address, and a global 300 a second - so a client inside its own allowance
/// still meets 503s when theirs is full, and there is no way to tell the two
/// apart from the status code. A pass measured in hours either way loses
/// nothing by asking less often, and
/// [82d](../../../docs/issues/done/82d-the-pass-cannot-finish.md) is what a
/// pass that ran at the limit looked like.
const INTERVAL: Duration = Duration::from_secs(3);

/// The interval the shared limiter runs at in this build.
///
/// Scaled down under `cargo test` so that the hundreds of assertions which
/// only incidentally make a request do not each pay three seconds. The rule
/// itself is still asserted at [`INTERVAL`], against a limiter built with it -
/// what is scaled down is the ambient gate, not the thing under test.
#[cfg(not(test))]
const SHARED_INTERVAL: Duration = INTERVAL;
#[cfg(test)]
const SHARED_INTERVAL: Duration = Duration::from_millis(10);

/// A gate that lets one request through at a time, spaced by an interval.
pub struct Limiter {
    interval: Duration,
    /// When the last request *finished*. The lock is held across both the
    /// sleep and the request: two threads must queue rather than both see the
    /// same stale instant, and a request still in flight has not been counted
    /// at the other end yet.
    finished: Mutex<Option<Instant>>,
}

impl Limiter {
    pub const fn new(interval: Duration) -> Self {
        Self {
            interval,
            finished: Mutex::new(None),
        }
    }

    /// Runs `call` as the only request in flight, no sooner than `interval`
    /// after the last one came back.
    ///
    /// Measured from the end of the previous request rather than its start,
    /// because a request that has not been answered yet is one this process
    /// cannot know the cost of - and the whole reason for the interval is that
    /// the count that matters is taken at the far end.
    pub fn run<T>(&self, call: impl FnOnce() -> T) -> T {
        let mut finished = self
            .finished
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(previous) = *finished {
            let elapsed = previous.elapsed();
            if elapsed < self.interval {
                std::thread::sleep(self.interval - elapsed);
            }
        }

        let answer = call();
        *finished = Some(Instant::now());
        answer
    }
}

/// The limiter every MusicBrainz call goes through.
pub fn shared() -> &'static Limiter {
    static SHARED: Limiter = Limiter::new(SHARED_INTERVAL);
    &SHARED
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_request_is_not_delayed() {
        let limiter = Limiter::new(Duration::from_millis(200));
        let started = Instant::now();
        limiter.run(|| {});
        assert!(started.elapsed() < Duration::from_millis(100));
    }

    #[test]
    fn a_second_request_waits_out_the_interval() {
        let limiter = Limiter::new(Duration::from_millis(200));
        let started = Instant::now();
        limiter.run(|| {});
        limiter.run(|| {});
        assert!(started.elapsed() >= Duration::from_millis(200));
    }

    /// The interval is measured from the end of a request, so a slow one does
    /// not eat into the gap after it. A limiter that gated only the start
    /// would let the next request go while this one was still in flight.
    #[test]
    fn a_slow_request_does_not_shorten_the_gap_after_it() {
        let limiter = Limiter::new(Duration::from_millis(200));
        let started = Instant::now();

        limiter.run(|| std::thread::sleep(Duration::from_millis(300)));
        limiter.run(|| {});

        assert!(
            started.elapsed() >= Duration::from_millis(500),
            "the second request went out {:?} in, before the first had been answered for a whole interval",
            started.elapsed()
        );
    }

    /// The case a per-client limiter gets wrong, and the reason this one is
    /// shared: two callers that never meet still have to queue behind each
    /// other, because the limit is enforced at the address they share.
    ///
    /// At the real [`INTERVAL`], so what is asserted is the rule as it ships
    /// rather than a scaled-down imitation of it.
    #[test]
    fn two_callers_serialize_against_each_other() {
        let limiter = Limiter::new(INTERVAL);
        let started = Instant::now();
        std::thread::scope(|scope| {
            for _ in 0..2 {
                scope.spawn(|| limiter.run(|| {}));
            }
        });

        assert!(
            started.elapsed() >= INTERVAL,
            "two concurrent callers went through in {:?}, which is closer together than {INTERVAL:?}",
            started.elapsed()
        );
    }

    /// One gate for the whole process, which is the property every caller
    /// depends on and the reason none of them owns a limiter.
    #[test]
    fn every_caller_reaches_the_same_gate() {
        assert!(std::ptr::eq(shared(), shared()));
    }
}
