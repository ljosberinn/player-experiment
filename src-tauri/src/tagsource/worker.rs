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
//!
//! Waking and sweeping are two different cadences. The switch is read every
//! [`TICK`] because that is what makes it feel immediate, and it costs one
//! keyed row. A sweep costs two group-bys over every track in the library, so
//! a library with nothing left to look up backs off towards [`IDLE_MAX`]
//! rather than asking that question four times a minute forever.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

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

/// The longest a library with nothing to do waits between sweeps.
///
/// A sweep over a finished library is two group-bys over every track - a fifth
/// of a second on 65,000 of them, one of which takes the write lock - to be
/// told there is nothing to do. At [`TICK`] that is 5,760 of them a day. The
/// cost of the ceiling is that a release a scan has just added waits up to ten
/// minutes for its lookup, which is nothing beside a pass measured in hours.
const IDLE_MAX: Duration = Duration::from_secs(600);

/// How many pending releases are read at a time.
///
/// `lookup::pending` groups every row of `tracks`, so asking for one release at
/// a time would spend a pass that already takes hours scanning that table
/// eight thousand times. Large enough to amortise it, small enough that a
/// release retagged mid-pass is picked up within a batch.
const BATCH: usize = 200;

/// What a sweep runs by, and where the last one got to.
///
/// Owned by the thread rather than built per sweep, because `surveyed` has to
/// outlive a sweep that ended early.
#[derive(Debug, Clone, Copy)]
pub struct Plan {
    /// Report the verdict per release and write nothing - neither files nor
    /// rows.
    pub dry_run: bool,
    pub batch: usize,
    /// How many releases a dry run has been through.
    ///
    /// **A real pass leaves this at zero.** Its rows are its cursor, which is
    /// what makes it resume across a quit; a dry run writes none, so this is
    /// the only thing standing between it and surveying its first batch over
    /// and over. It survives a sweep that a 503 ended, and it does not survive
    /// the process - a rehearsal is one sitting.
    pub surveyed: usize,
}

impl Plan {
    /// What the thread runs with.
    pub fn from_env() -> Self {
        Self {
            dry_run: pass::dry_run(),
            batch: BATCH,
            surveyed: 0,
        }
    }
}

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
/// cancels a pass rather than merely stopping the next one. It answers with a
/// `Result` rather than a bool because those are three outcomes and not two:
/// a switch that cannot be read is not a switch that is off.
pub fn sweep(
    db: &Db,
    lock: &ScanLock,
    transport: &(dyn Transport + '_),
    log: &Log,
    staging: &Path,
    plan: &mut Plan,
    enabled: &dyn Fn() -> AppResult<bool>,
) -> AppResult<Summary> {
    let mut summary = Summary::default();

    let mut conn = db.conn()?;
    // Free, and it is what keeps a re-install or a rescan of an already-tagged
    // library off the hours. Behind the same check as every other write: it is
    // the one row a dry run would otherwise leave behind.
    if !plan.dry_run {
        lookup::seed_from_tags(&conn, crate::now_seconds())?;
    }

    loop {
        let batch = lookup::pending(&conn, plan.batch, plan.surveyed)?;
        if batch.is_empty() {
            return Ok(summary);
        }

        for release in &batch {
            match enabled() {
                Ok(true) => {}
                Ok(false) => return Ok(summary),
                // Carried on rather than stopped: a database busy for a moment
                // is not the user changing their mind, and if it is more than
                // a moment the next write fails and ends the sweep anyway. The
                // line is so the log can tell the two apart.
                Err(error) => log.op("lookup.switch").failed(&error),
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
                plan.dry_run,
                crate::now_seconds(),
            );
            // Per release attempted rather than per batch read, and past one
            // that failed as well: a survey with a hole in it is worth more
            // than one stuck on the release that always fails.
            if plan.dry_run {
                plan.surveyed += 1;
            }

            // Logged by hand rather than through `Op::run_with`, because which
            // of the two this is - a line, or silence - is not known until the
            // work has run, and `Op::quiet` is decided before it does. 8,044
            // lines about what was written is nothing next to a bad threshold
            // that cannot be diagnosed after the fact; 8,044 more about
            // releases MusicBrainz has never heard of is noise.
            match &verdict {
                Ok(Verdict::NotFound) => {}
                Ok(verdict) => op.succeeded(verdict_fields(verdict, plan.dry_run)),
                Err(error) => op.failed(error),
            }

            match verdict {
                Ok(Verdict::Written { .. }) => summary.resolved += 1,
                Ok(Verdict::Queued { .. }) => summary.queued += 1,
                Ok(Verdict::NotFound) => summary.missed += 1,
                // A release that failed keeps no row, so a real pass tries it
                // again next sweep - right for a network that was down,
                // harmless for one that was not. Stopping rather than carrying
                // on, because the usual cause is that every following release
                // would fail the same way, one rate-limited request at a time.
                Err(_) => return Ok(summary),
            }
        }
    }
}

/// How long to leave before the next sweep, given what the last one got done.
///
/// **Getting through releases is the whole test, whether or not the sweep then
/// ended on one.** A sweep that looked up twenty-six releases and then met a
/// 503 has proved both that the service is answering and that the library has
/// work left in it, so the next one comes straight away. Counting it as idle
/// would push a pass that is steadily working through the library out to
/// ten-minute gaps and add days to it.
///
/// A sweep that got through *nothing* - a finished library, or a first release
/// that failed - waits longer each time. That is what keeps a finished library
/// from being re-grouped four times a minute, and a service that is down from
/// being asked every fifteen seconds.
fn next_sweep(previous: Duration, attempted: usize) -> Duration {
    if attempted > 0 {
        TICK
    } else {
        (previous * 2).min(IDLE_MAX)
    }
}

/// Enough of the number to diagnose a bad threshold after the fact.
///
/// `NotFound` carries nothing because it is never logged: a release
/// MusicBrainz has never heard of is not something that happened.
///
/// A dry run says `would-write` where a real pass says `written`, and the same
/// for the queue. The status is the field anyone reads a pass by, and for the
/// one feature in this app that writes tags nobody approved, a line that
/// cannot be told from a line about a write is worse than no line.
fn verdict_fields(verdict: &Verdict, dry_run: bool) -> Fields {
    match verdict {
        Verdict::Written {
            mbid,
            score,
            tracks,
        } => Fields::new()
            .add("status", if dry_run { "would-write" } else { "written" })
            .add("mbid", mbid)
            .add("score", format!("{score:.3}"))
            .add("tracks", tracks),
        Verdict::Queued { score, candidates } => Fields::new()
            .add("status", if dry_run { "would-queue" } else { "queued" })
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
        .spawn(move || {
            // The dry run's cursor lives out here, so a sweep a 503 ended does
            // not send the survey back to the first release. A real pass never
            // touches it.
            let mut plan = Plan::from_env();
            // How long to leave between sweeps, as against between wakes. It
            // doubles while there is nothing to do and snaps back the moment
            // there is.
            let mut quiet = TICK;
            let mut due = Instant::now();

            loop {
                std::thread::sleep(TICK);

                // One connection for the whole sweep rather than one per
                // release: the switch is read thousands of times and opening a
                // database to read one row is most of what that costs.
                let switch = match db.conn() {
                    Ok(conn) => conn,
                    Err(error) => {
                        log.op("lookup.switch").failed(&error);
                        continue;
                    }
                };
                // Read every wake and every release rather than captured once:
                // that is what makes the switch cancel rather than merely stop
                // the next pass, and what lets turning it back on resume
                // without a restart.
                let enabled = || settings::unattended_lookup(&switch);
                match enabled() {
                    Ok(true) => {}
                    Ok(false) => continue,
                    Err(error) => {
                        log.op("lookup.switch").failed(&error);
                        continue;
                    }
                }
                // The switch is answered every wake; the library is not asked
                // until a sweep is due.
                if Instant::now() < due {
                    continue;
                }
                let Some(transport) = crate::tagsource::transport::shared() else {
                    continue;
                };

                let op = log.op("lookup.sweep");
                let summary = sweep(&db, &lock, transport, &log, &staging, &mut plan, &enabled);

                let attempted = summary.as_ref().map_or(0, |summary| summary.attempted());
                quiet = next_sweep(quiet, attempted);
                due = Instant::now() + quiet;

                match &summary {
                    Ok(summary) => op.succeeded(
                        Fields::new()
                            .add("resolved", summary.resolved)
                            .add("queued", summary.queued)
                            .add("missed", summary.missed)
                            .add("next", format!("{}s", quiet.as_secs())),
                    ),
                    Err(error) => op.failed(error),
                }

                if matches!(&summary, Ok(summary) if summary.resolved > 0) {
                    on_change();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tagsource::pass::tests::{add_release, library, musicbrainz, LOVELESS_DURATIONS};
    use crate::tagsource::transport::FakeTransport;

    /// A real pass over whole batches, which is every test here but the ones
    /// about paging.
    fn live() -> Plan {
        Plan {
            dry_run: false,
            batch: BATCH,
            surveyed: 0,
        }
    }

    /// A dry run reading one release at a time, so that a second batch is
    /// reached without a library of two hundred of them.
    fn dry() -> Plan {
        Plan {
            dry_run: true,
            batch: 1,
            surveyed: 0,
        }
    }

    /// The switch held on, which is every test here but the one that flips it.
    fn on() -> impl Fn() -> AppResult<bool> {
        || Ok(true)
    }

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
        let first = sweep(
            &db,
            &lock,
            &transport,
            &log,
            dir.path(),
            &mut live(),
            &|| {
                let before = seen.get();
                seen.set(before + 1);
                Ok(before < 1)
            },
        )
        .unwrap();
        assert_eq!(first.attempted(), 1);

        let second = sweep(&db, &lock, &transport, &log, dir.path(), &mut live(), &on()).unwrap();
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
            sweep(&db, &lock, &transport, &log, dir.path(), &mut live(), &on())
                .unwrap()
                .attempted(),
            2
        );
        let spent = transport.call_count();

        let again = sweep(&db, &lock, &transport, &log, dir.path(), &mut live(), &on()).unwrap();

        assert_eq!(again.attempted(), 0);
        assert_eq!(
            transport.call_count(),
            spent,
            "and it costs no requests at all"
        );
    }

    /// The seed, asserted through the sweep: a library already carrying its
    /// identities must not pay for the whole pass again.
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
            &mut live(),
            &on(),
        )
        .unwrap();

        assert_eq!(summary.attempted(), 0);
        assert_eq!(transport.call_count(), 0);
    }

    /// The assertion whose absence let a dry run ship that could only ever
    /// report on its first batch: with no row to read as a cursor, the second
    /// batch is only reachable by paging.
    ///
    /// The switch goes off after four releases so that a dry run which cannot
    /// page fails here rather than running forever.
    #[test]
    fn a_dry_run_reaches_the_second_batch() {
        let (dir, db) = two_releases();
        let log = log_to(dir.path());
        let seen = std::cell::Cell::new(0);

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &musicbrainz(),
            &log,
            dir.path(),
            &mut dry(),
            &|| {
                let before = seen.get();
                seen.set(before + 1);
                Ok(before < 4)
            },
        )
        .unwrap();

        assert_eq!(
            summary.attempted(),
            2,
            "each release once, which means the second batch was read"
        );
    }

    /// A dry run writes nothing at all, and the seed is the one write that is
    /// not a verdict - which is why there was a row in the table after a run
    /// that was meant to leave none.
    #[test]
    fn a_dry_run_leaves_the_table_empty_seed_included() {
        let (dir, db) = two_releases();
        db.conn()
            .unwrap()
            .execute("UPDATE tracks SET release_mbid = 'bb5a'", [])
            .unwrap();

        sweep(
            &db,
            &ScanLock::default(),
            &musicbrainz(),
            &log_to(dir.path()),
            dir.path(),
            &mut dry(),
            &on(),
        )
        .unwrap();

        assert_eq!(
            db.conn()
                .unwrap()
                .query_row("SELECT count(*) FROM release_lookup", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    /// What sent the survey back to the first release every time: a sweep a
    /// 503 ended is the ordinary case, not the exception, and the cursor has
    /// to outlive it. The failed release is passed over rather than retried
    /// forever - a survey with a hole beats one that cannot move.
    #[test]
    fn a_dry_run_carries_its_place_across_a_sweep_that_failed() {
        let (dir, db) = two_releases();
        let log = log_to(dir.path());
        let mut plan = dry();

        let refused = FakeTransport::new().failing(
            "/ws/2/release",
            crate::tagsource::transport::TransportError::Server {
                host: "musicbrainz.org".to_owned(),
                status: 503,
            },
        );
        let first = sweep(
            &db,
            &ScanLock::default(),
            &refused,
            &log,
            dir.path(),
            &mut plan,
            &on(),
        )
        .unwrap();
        assert_eq!(first.attempted(), 0, "it got a verdict for nothing");
        assert_eq!(plan.surveyed, 1, "but it did get past the release");

        let second = sweep(
            &db,
            &ScanLock::default(),
            &musicbrainz(),
            &log,
            dir.path(),
            &mut plan,
            &on(),
        )
        .unwrap();

        assert_eq!(
            second.attempted(),
            1,
            "the survey carries on from the second release rather than starting over"
        );
    }

    /// The pass spends most of its life over a finished library, and a sweep
    /// over one is two group-bys across every track in it.
    #[test]
    fn a_sweep_with_nothing_to_do_waits_longer_each_time() {
        let mut quiet = TICK;
        for expected in [30, 60, 120, 240, 480] {
            quiet = next_sweep(quiet, 0);
            assert_eq!(quiet, Duration::from_secs(expected));
        }

        quiet = next_sweep(quiet, 0);
        assert_eq!(quiet, IDLE_MAX, "and stops there");
        assert_eq!(next_sweep(quiet, 0), IDLE_MAX);
    }

    /// The one that was wrong: a sweep a 503 ended after twenty-six releases
    /// is a library with work left in it, not an idle one. Treating it as idle
    /// backed a working pass off to ten-minute gaps and added days to it.
    #[test]
    fn a_sweep_that_got_through_releases_comes_straight_back() {
        assert_eq!(next_sweep(TICK, 26), TICK);
        assert_eq!(
            next_sweep(IDLE_MAX, 26),
            TICK,
            "however long the gap had grown to"
        );
    }

    /// A finished library is the state the pass spends most of its life in,
    /// and a sweep over one is two group-bys over every track in it.
    #[test]
    fn a_sweep_with_nothing_to_do_says_so() {
        let (dir, db) = two_releases();
        let mut plan = live();
        let log = log_to(dir.path());

        sweep(
            &db,
            &ScanLock::default(),
            &musicbrainz(),
            &log,
            dir.path(),
            &mut plan,
            &on(),
        )
        .unwrap();
        let idle = sweep(
            &db,
            &ScanLock::default(),
            &musicbrainz(),
            &log,
            dir.path(),
            &mut plan,
            &on(),
        )
        .unwrap();

        assert_eq!(idle.attempted(), 0);
    }
}
