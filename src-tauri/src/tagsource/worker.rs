//! The thread that drives the unattended pass.
//!
//! `scan::watch::spawn`'s shape, not `commands::blocking`'s: that helper wraps
//! a command that returns when its work finishes, and a four-and-a-half-hour
//! command is not that. A named thread owning a `Db` handle, started from
//! `lib.rs`, joined by nobody.
//!
//! The switch is read between releases rather than captured at start, which is
//! what makes turning it off cancel a pass in flight and turning it back on
//! resume - from `release_lookup`, not from the top.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::db::{lookup, settings, Db};
use crate::error::AppResult;
use crate::log::{Fields, Log};
use crate::scan::ScanLock;
use crate::tagsource::pass::{self, Verdict};
use crate::tagsource::transport::Transport;

/// How often the thread wakes to ask whether the switch is on.
///
/// The same fifteen seconds `scan::watch` waits, and for the same reason: it
/// decides only how soon a changed setting takes effect.
const TICK: Duration = Duration::from_secs(15);

/// How many pending releases are read at a time.
///
/// `lookup::pending` groups every row of `tracks`, so asking for one release at
/// a time would spend a pass that already takes four and a half hours scanning
/// that table eight thousand times. Large enough to amortise it, small enough
/// that a release retagged mid-pass is picked up within a batch.
const BATCH: usize = 200;

/// What a sweep came to.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Summary {
    pub resolved: usize,
    pub queued: usize,
    pub missed: usize,
}

impl Summary {
    /// Releases this sweep got through, whatever it decided about them.
    pub fn attempted(self) -> usize {
        self.resolved + self.queued + self.missed
    }
}

/// Works through every release with no row, until there are none left or the
/// switch goes off.
///
/// `enabled` is consulted before every release rather than once, so the switch
/// cancels a pass rather than merely stopping the next one.
pub fn sweep(
    db: &Db,
    lock: &ScanLock,
    transport: &(dyn Transport + '_),
    log: &Log,
    staging: &Path,
    enabled: &dyn Fn() -> bool,
) -> AppResult<Summary> {
    let dry_run = pass::dry_run();
    let mut summary = Summary::default();

    let mut conn = db.conn()?;
    // Free, and it is what keeps a re-install or a rescan of an already-tagged
    // library off the four and a half hours.
    lookup::seed_from_tags(&conn, crate::now_seconds())?;

    loop {
        let batch = lookup::pending(&conn, BATCH)?;
        if batch.is_empty() {
            return Ok(summary);
        }

        for release in &batch {
            if !enabled() {
                return Ok(summary);
            }

            let op = log
                .op("lookup.release")
                .add("album", release.album.as_deref().unwrap_or("-"))
                .add("artist", release.artist.as_deref().unwrap_or("-"));
            let verdict = pass::look_up(
                &mut conn,
                transport,
                lock,
                release,
                staging,
                dry_run,
                crate::now_seconds(),
            );

            // Logged by hand rather than through `Op::run_with`, because which
            // of the two this is - a line, or silence - is not known until the
            // work has run, and `Op::quiet` is decided before it does. 8,044
            // lines about what was written is nothing next to a bad threshold
            // that cannot be diagnosed after the fact; 8,044 more about
            // releases MusicBrainz has never heard of is noise.
            match &verdict {
                Ok(Verdict::NotFound) => {}
                Ok(verdict) => op.succeeded(verdict_fields(verdict)),
                Err(error) => op.failed(error),
            }

            match verdict {
                Ok(Verdict::Written { .. }) => summary.resolved += 1,
                Ok(Verdict::Queued { .. }) => summary.queued += 1,
                Ok(Verdict::NotFound) => summary.missed += 1,
                // A release that failed keeps no row, so the next sweep tries
                // it again - right for a network that was down, harmless for
                // one that was not. Stopping rather than carrying on, because
                // the usual cause is that every following release would fail
                // the same way, one rate-limited second at a time.
                Err(_) => return Ok(summary),
            }
        }
    }
}

/// Enough of the number to diagnose a bad threshold after the fact.
///
/// `NotFound` carries nothing because it is never logged: a release
/// MusicBrainz has never heard of is not something that happened.
fn verdict_fields(verdict: &Verdict) -> Fields {
    match verdict {
        Verdict::Written {
            mbid,
            score,
            tracks,
        } => Fields::new()
            .add("status", "written")
            .add("mbid", mbid)
            .add("score", format!("{score:.3}"))
            .add("tracks", tracks),
        Verdict::Queued { score, candidates } => Fields::new()
            .add("status", "queued")
            .add("score", format!("{score:.3}"))
            .add("candidates", candidates),
        Verdict::NotFound => Fields::new(),
    }
}

/// Starts the `release-lookup` thread.
///
/// `on_change` runs after a sweep that wrote something. A sweep that only
/// queued or missed says nothing to the window: nothing a view draws changed.
pub fn spawn(
    db: Db,
    lock: ScanLock,
    log: Log,
    staging: PathBuf,
    on_change: impl Fn() + Send + 'static,
) {
    let _ = std::thread::Builder::new()
        .name("release-lookup".to_owned())
        .spawn(move || loop {
            std::thread::sleep(TICK);

            // Read every wake and every release rather than captured once:
            // that is what makes the switch cancel rather than merely stop the
            // next pass, and what lets turning it back on resume without a
            // restart.
            let enabled = || {
                db.conn()
                    .and_then(|conn| settings::unattended_lookup(&conn))
                    .unwrap_or(false)
            };
            if !enabled() {
                continue;
            }
            let Some(transport) = crate::tagsource::transport::shared() else {
                continue;
            };

            let op = log.op("lookup.sweep");
            let summary = sweep(&db, &lock, transport, &log, &staging, &enabled);

            match &summary {
                Ok(summary) => op.succeeded(
                    Fields::new()
                        .add("resolved", summary.resolved)
                        .add("queued", summary.queued)
                        .add("missed", summary.missed),
                ),
                Err(error) => op.failed(error),
            }

            if matches!(&summary, Ok(summary) if summary.resolved > 0) {
                on_change();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tagsource::pass::tests::{add_release, library, musicbrainz, LOVELESS_DURATIONS};
    use crate::tagsource::transport::FakeTransport;

    /// Two releases, both answerable by the same fixtures.
    ///
    /// The same fixtures on purpose: `FakeTransport` matches on URL substrings
    /// and the album is a `query` *parameter* rather than part of the URL, so
    /// two searches cannot be routed to two different bodies. Nothing here
    /// needs them to be - these tests count the releases a sweep got through,
    /// and what it decides about each is `pass`'s to assert.
    fn two_releases() -> (tempfile::TempDir, Db) {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        add_release(
            &db,
            dir.path(),
            "Isn't Anything",
            "My Bloody Valentine",
            &LOVELESS_DURATIONS,
        );
        (dir, db)
    }

    fn log_to(dir: &Path) -> Log {
        Log::to(dir.join("apex.log"))
    }

    /// The resume point, which is what the table is for: a pass cut short by a
    /// quit starts from where it stopped rather than from the top.
    #[test]
    fn a_cancelled_sweep_resumes_where_it_stopped() {
        let (dir, db) = two_releases();
        let lock = ScanLock::default();
        let log = log_to(dir.path());
        let transport = musicbrainz();

        // Off after the first release: this closure is what the switch flips.
        let seen = std::cell::Cell::new(0);
        let first = sweep(&db, &lock, &transport, &log, dir.path(), &|| {
            let before = seen.get();
            seen.set(before + 1);
            before < 1
        })
        .unwrap();
        assert_eq!(first.attempted(), 1);

        let second = sweep(&db, &lock, &transport, &log, dir.path(), &|| true).unwrap();
        assert_eq!(
            second.attempted(),
            1,
            "the second sweep does the release the first did not, and not the one it did"
        );
    }

    #[test]
    fn a_second_sweep_over_a_finished_library_does_nothing() {
        let (dir, db) = two_releases();
        let lock = ScanLock::default();
        let log = log_to(dir.path());
        let transport = musicbrainz();

        assert_eq!(
            sweep(&db, &lock, &transport, &log, dir.path(), &|| true)
                .unwrap()
                .attempted(),
            2
        );
        let spent = transport.call_count();

        let again = sweep(&db, &lock, &transport, &log, dir.path(), &|| true).unwrap();

        assert_eq!(again.attempted(), 0);
        assert_eq!(
            transport.call_count(),
            spent,
            "and it costs no requests at all"
        );
    }

    /// The seed, asserted through the sweep: a library already carrying its
    /// identities must not pay four and a half hours for them again.
    #[test]
    fn a_library_that_already_carries_its_mbids_costs_no_requests() {
        let (dir, db) = two_releases();
        db.conn()
            .unwrap()
            .execute("UPDATE tracks SET release_mbid = 'bb5a'", [])
            .unwrap();
        let transport = FakeTransport::new();

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &transport,
            &log_to(dir.path()),
            dir.path(),
            &|| true,
        )
        .unwrap();

        assert_eq!(summary.attempted(), 0);
        assert_eq!(transport.call_count(), 0);
    }
}
