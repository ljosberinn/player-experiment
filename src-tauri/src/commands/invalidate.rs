//! Coalescing `library://changed` on the emit side.
//!
//! One ping per write is right for the writes a person makes; it stops being
//! right for a write that commits thousands of times in a row - a scan, an
//! import, a long tag edit - where every ping is a full re-query of the open
//! view plus a recount of every playlist, smart ones by re-running their
//! compiled filter.
//!
//! Debouncing harder in the frontend cannot fix it: the pings are already far
//! enough apart to clear `INVALIDATE_DEBOUNCE_MS` by the time they arrive. So
//! the coalescing happens here, once, and every long write inherits it.

use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};

use super::LIBRARY_CHANGED;

/// The longest a view is allowed to be out of date while a write keeps
/// committing.
///
/// Provisional, and no longer sized by what it was sized for. It was reasoned
/// against 82b's lookup pass committing a release every two seconds; 82e's
/// limiter put that at one every forty, so the pass now coalesces nothing here
/// and needs nothing to. What the window still earns its keep on is a write
/// that really does commit in a run - a scan, an import, a bulk tag edit -
/// which is what it should be measured against when anyone does.
const WINDOW: Duration = Duration::from_secs(5);

/// What to do with a ping that has just arrived.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Claim {
    /// Nothing has been said for a whole window, so this goes out now. The
    /// leading edge is what keeps a single tag edit or playlist rename as
    /// immediate as it was before any of this existed.
    Now,
    /// A window is open. Say it again once this much of it is left, so a run
    /// of writes still lands on screen at the window's rate.
    After(Duration),
    /// A window is open and its trailing ping is already scheduled. Nothing to
    /// do: that ping will describe this write too.
    Absorbed,
}

/// When `library://changed` was last said, and whether it is about to be said
/// again.
///
/// Managed state rather than a static, so it belongs to the app the way every
/// other cross-command fact does and a test can build one without a runtime.
#[derive(Default)]
pub(crate) struct Invalidations {
    window: Mutex<Window>,
}

#[derive(Default)]
struct Window {
    /// `None` until the first ping of the session.
    said: Option<Instant>,
    scheduled: bool,
}

impl Invalidations {
    fn claim(&self, now: Instant) -> Claim {
        let mut window = self.lock();
        match window.said.map(|said| now.saturating_duration_since(said)) {
            Some(since) if since < WINDOW => {
                if window.scheduled {
                    return Claim::Absorbed;
                }
                window.scheduled = true;
                Claim::After(WINDOW - since)
            }
            _ => {
                window.said = Some(now);
                Claim::Now
            }
        }
    }

    /// Records the trailing ping going out, which opens the next window.
    ///
    /// Opening it here rather than leaving the next writer to take the leading
    /// edge is the whole point: a pass that commits every two seconds would
    /// otherwise alternate between a trailing ping and an immediate one and
    /// coalesce half as much as the window promises.
    fn said(&self, now: Instant) {
        let mut window = self.lock();
        window.said = Some(now);
        window.scheduled = false;
    }

    /// A poisoned lock holds two facts about when to send a notification;
    /// there is nothing here for a panic to have corrupted.
    fn lock(&self) -> std::sync::MutexGuard<'_, Window> {
        self.window.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Tells every open view that the library is no longer what it thinks.
///
/// The only route to this event. A dropped event is not worth failing a write
/// that has already committed, so every send here is ignored.
pub(crate) fn announce(app: &tauri::AppHandle) {
    let Some(invalidations) = app.try_state::<Invalidations>() else {
        // Only reachable if something announces before `setup` has managed the
        // state. Better a redundant re-query than a view that never hears.
        let _ = app.emit(LIBRARY_CHANGED, ());
        return;
    };

    let wait = match invalidations.claim(Instant::now()) {
        Claim::Now => {
            let _ = app.emit(LIBRARY_CHANGED, ());
            return;
        }
        Claim::Absorbed => return,
        Claim::After(wait) => wait,
    };

    // A thread rather than a task on the async runtime, matching how the
    // watcher and the MusicBrainz rate limiter already wait. At most one is
    // alive at a time, since `scheduled` is what got us here.
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(wait);
        app.state::<Invalidations>().said(Instant::now());
        let _ = app.emit(LIBRARY_CHANGED, ());
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_ping_of_a_session_goes_out_at_once() {
        let invalidations = Invalidations::default();
        assert_eq!(invalidations.claim(Instant::now()), Claim::Now);
    }

    #[test]
    fn a_ping_after_a_whole_quiet_window_goes_out_at_once() {
        let invalidations = Invalidations::default();
        let start = Instant::now();
        assert_eq!(invalidations.claim(start), Claim::Now);
        assert_eq!(invalidations.claim(start + WINDOW), Claim::Now);
    }

    #[test]
    fn a_run_of_pings_inside_a_window_becomes_one_trailing_ping() {
        let invalidations = Invalidations::default();
        let start = Instant::now();
        assert_eq!(invalidations.claim(start), Claim::Now);

        assert_eq!(
            invalidations.claim(start + Duration::from_secs(2)),
            Claim::After(WINDOW - Duration::from_secs(2)),
            "the trailing ping lands at the end of the open window, not a window later"
        );
        assert_eq!(
            invalidations.claim(start + Duration::from_secs(3)),
            Claim::Absorbed
        );
        assert_eq!(
            invalidations.claim(start + Duration::from_secs(4)),
            Claim::Absorbed
        );
    }

    #[test]
    fn a_trailing_ping_opens_the_next_window_rather_than_ending_the_run() {
        let invalidations = Invalidations::default();
        let start = Instant::now();
        invalidations.claim(start);
        invalidations.claim(start + Duration::from_secs(2));
        invalidations.said(start + WINDOW);

        // What a steady pass looks like: without `said` moving the window this
        // would be a leading edge, and the pass would emit twice per window.
        assert_eq!(
            invalidations.claim(start + WINDOW + Duration::from_secs(1)),
            Claim::After(WINDOW - Duration::from_secs(1))
        );
    }

    #[test]
    fn a_steady_pass_emits_once_per_window_however_fast_it_commits() {
        let invalidations = Invalidations::default();
        let start = Instant::now();
        let mut emitted = 0;
        let mut due: Option<Instant> = None;

        // One commit every 500ms for an hour, four times the rate the lookup
        // pass manages.
        for tick in 0..7_200 {
            let now = start + Duration::from_millis(tick * 500);
            if due.is_some_and(|at| at <= now) {
                invalidations.said(now);
                due = None;
                emitted += 1;
            }
            match invalidations.claim(now) {
                Claim::Now => emitted += 1,
                Claim::After(wait) => due = Some(now + wait),
                Claim::Absorbed => {}
            }
        }

        assert_eq!(
            emitted, 720,
            "an hour at a five second window is 720 pings, not one per commit"
        );
    }
}
