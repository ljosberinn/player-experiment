//! The thread that drives the unattended pass.
//!
//! `scan::watch::spawn`'s shape, not `commands::blocking`'s: that helper wraps
//! a command that returns when its work finishes, and a four-and-a-half-hour
//! command is not that. A named thread owning a `Db` handle, started from
//! `lib.rs`, joined by nobody.
//!
//! **One pass, not two.** Placing a release means reading the tags the lookup
//! writes, so as two passes the two would be coupled per release, and every way
//! of expressing that coupling is worse than not having it: a gate stalls the
//! backfill behind forty-five hours of lookups, no gate moves 8,044 releases
//! twice, and either way `task://progress` gets two producers whose labels
//! overwrite each other. Here the release is looked up and placed in the same
//! visit, in that order, and there is nothing to coordinate because there is
//! nothing running alongside. `tagsource::pass::look_up` stays where it is and
//! is called from here.
//!
//! The switches are read between releases rather than captured at start, which
//! is what makes turning one off cancel its own step mid-pass and turning it
//! back on resume - from the library's own state, not from the top.
//!
//! Waking and sweeping are two different cadences. The switches are read every
//! [`TICK`] because that is what makes them feel immediate, and it costs two
//! keyed rows. A sweep costs a sort of every row in `tracks`, so a library with
//! nothing left to do backs off towards [`IDLE_MAX`] rather than asking that
//! question four times a minute forever.

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use rusqlite::Connection;

use crate::db::{lookup, query, settings, Db};
use crate::error::AppResult;
use crate::library::mover;
use crate::library::survey::{self, Pending, Steps};
use crate::log::{Fields, Log};
use crate::model::BackgroundTask;
use crate::scan::ScanLock;
use crate::tagsource::pass::{self, Outcome, Verdict};
use crate::tagsource::transport::Transport;

/// How often the thread wakes to ask whether either switch is on.
///
/// The same fifteen seconds `scan::watch` waits, and for the same reason: it
/// decides only how soon a changed setting takes effect.
const TICK: Duration = Duration::from_secs(15);

/// The longest a library with nothing to do waits between sweeps.
///
/// A sweep over a finished library is a sort of every row in `tracks` - a
/// fifth of a second on 65,000 of them - to be told there is nothing to do. At
/// [`TICK`] that is 5,760 of them a day. The cost of the ceiling is that a
/// release a scan has just added waits up to ten minutes, which is nothing
/// beside a pass measured in hours.
const IDLE_MAX: Duration = Duration::from_secs(600);

/// How many releases are taken from one survey.
///
/// The survey sorts every row of `tracks`, so asking for one release at a time
/// would spend a pass that already takes hours sorting that table eight
/// thousand times. Large enough to amortise it, small enough that a release
/// retagged mid-pass is picked up within a batch.
const BATCH: usize = 200;

/// What a sweep runs by, and where the last one got to.
///
/// Owned by the thread rather than built per sweep, because neither the
/// rehearsal's place nor the pace may die with a sweep that ended early.
#[derive(Debug, Default)]
pub struct Plan {
    /// Report the verdict per release and write nothing - neither files nor
    /// rows.
    pub dry_run: bool,
    pub batch: usize,
    /// Releases a dry run has already reported on.
    ///
    /// **A real pass leaves this empty.** Its work is its cursor - a written
    /// row, a moved file - which is what makes it resume across a quit; a dry
    /// run leaves neither, so this is the only thing standing between it and
    /// surveying its first batch over and over. It survives a sweep that a 503
    /// ended, and it does not survive the process: a rehearsal is one sitting.
    pub rehearsed: HashSet<lookup::Key>,
    /// What the readout is told, and what it takes to say it.
    pub pace: Pace,
}

impl Plan {
    /// What the thread runs with.
    pub fn from_env() -> Self {
        Self {
            dry_run: pass::dry_run(),
            batch: BATCH,
            ..Self::default()
        }
    }
}

/// What a sweep calls back into the thread that owns it.
///
/// Closures rather than parameters, because a sweep already takes as many as
/// it should.
pub struct Signals<'a> {
    /// Which steps may run. Asked before every batch and before every release,
    /// so a switch cancels its own step rather than merely stopping the next
    /// pass, and it answers with a `Result` because a switch that cannot be
    /// read is not a switch that is off.
    pub steps: &'a dyn Fn() -> AppResult<Steps>,
    /// A release was written, queued or moved.
    ///
    /// **Per release, not per sweep.** A sweep is hours long and may not end
    /// at all, so a view told at the end of one is a view that never hears.
    /// `commands::invalidate` is what keeps the cost of saying so per release
    /// down, and it was built for exactly this.
    ///
    /// Queuing counts as a change even though no file moved: 82c's review row
    /// carries the count, and a sidebar that learns of four hundred queued
    /// releases at the end of a forty-five hour pass has not been told. Once
    /// per release however many of the two steps ran.
    pub changed: &'a dyn Fn(),
    /// How far the pass has got, per release attempted.
    pub progress: &'a dyn Fn(&BackgroundTask),
    /// Which tracks the player holds a `std::fs::File` open on - the playing
    /// one and the queue's next.
    ///
    /// A closure for the same reason the switches are: it is a snapshot, and
    /// one read at the start of a four-hour sweep would describe a track that
    /// stopped playing three hours ago.
    pub open: &'a dyn Fn() -> HashSet<i64>,
}

/// What the readout says, and what it takes to say it.
///
/// Part of the [`Plan`] rather than built per sweep, for the same reason the
/// rehearsal's place is: a sweep that a 503 ended would otherwise throw away
/// the history the estimate is built from, and the pass would show no estimate
/// for its first few releases over and over.
#[derive(Debug, Default)]
pub struct Pace {
    /// Releases this sweep has been through.
    ///
    /// From nothing rather than from what earlier sweeps got done: the total
    /// beside it is what the survey found left to do, and the two have to be
    /// the same question for the fraction to reach 100%.
    done: usize,
    total: usize,
    /// How long each of the last [`RECENT`] releases took, oldest first.
    recent: VecDeque<Duration>,
}

/// How many releases the estimate is drawn from.
///
/// The rate is not steady: a release whose files already carry an MBID costs
/// nothing and a searched one costs two rate-limited requests, so an average
/// over the whole pass describes a pass that is not the one running. A
/// sub-second move beside a ten-second lookup is only more of that.
const RECENT: usize = 100;

/// How many releases it takes before there is an estimate worth showing.
const ENOUGH: usize = 3;

impl Pace {
    /// Opens the readout on what this sweep has to get through.
    fn begin(&mut self, total: usize) {
        self.done = 0;
        self.total = total;
    }

    /// Counts one release and says what the readout should now show.
    fn advance(&mut self, took: Duration, label: &str) -> BackgroundTask {
        self.done += 1;
        if self.recent.len() == RECENT {
            self.recent.pop_front();
        }
        self.recent.push_back(took);

        BackgroundTask {
            label: label.to_owned(),
            done: u32::try_from(self.done).unwrap_or(u32::MAX),
            total: u32::try_from(self.total).unwrap_or(u32::MAX),
            eta_ms: self.eta(),
        }
    }

    /// How much longer, from the recent rate, or none while there is not
    /// enough of it to be worth showing.
    fn eta(&self) -> Option<i64> {
        if self.recent.len() < ENOUGH {
            return None;
        }
        let remaining = self.total.saturating_sub(self.done) as u128;
        let each: u128 =
            self.recent.iter().map(Duration::as_millis).sum::<u128>() / self.recent.len() as u128;
        i64::try_from(remaining * each).ok()
    }
}

/// What a sweep came to.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Summary {
    /// Releases this sweep got through, whatever it decided about them.
    ///
    /// One per release rather than one per step: a release that was looked up
    /// and then moved is one release the sweep got through, and it is what the
    /// backoff and the readout both count.
    pub visited: usize,
    pub resolved: usize,
    pub queued: usize,
    pub missed: usize,
    /// Releases moved to where they go.
    pub placed: usize,
    /// Releases left where they are because the player had a file of one open.
    pub deferred: usize,
    /// Releases a move failed on - a locked file, a full disk.
    pub unmovable: usize,
    /// How many requests this sweep had to ask again before one was answered.
    ///
    /// The only measure of how much throttling a pass is absorbing. A retry
    /// that works leaves no other trace: the release resolves, and the five
    /// seconds it cost read as a slow request.
    pub retries: usize,
}

/// The things a sweep does not change between releases.
///
/// A struct rather than six more parameters on [`visit`].
struct Context<'a> {
    lock: &'a ScanLock,
    transport: &'a (dyn Transport + 'a),
    log: &'a Log,
    staging: &'a Path,
    signals: &'a Signals<'a>,
    /// What the readout calls this pass. Named from the steps that were on
    /// when the sweep opened, and unchanged for its length: a label that
    /// rewrote itself mid-run would read as a second task starting.
    label: &'a str,
}

/// What one release came to, from the sweep's point of view.
enum Visit {
    /// On to the next one.
    Next,
    /// The player holds a file of it open. Tried once more at the end of the
    /// sweep rather than dropped: a user who leaves one album on must not find
    /// it the only one left behind.
    Deferred,
    /// The lookup failed. The usual cause is that every following release
    /// would fail the same way, one rate-limited request at a time, so the
    /// step goes off for the rest of the sweep - the *step*, not the sweep,
    /// because a network that is down says nothing about moving files.
    LookupFailed,
}

/// Works through every release with either step left to do, until there are
/// none or both switches are off.
pub fn sweep(
    db: &Db,
    lock: &ScanLock,
    transport: &(dyn Transport + '_),
    log: &Log,
    staging: &Path,
    plan: &mut Plan,
    signals: &Signals<'_>,
) -> AppResult<Summary> {
    let mut summary = Summary::default();
    let mut conn = db.conn()?;

    let opening = (signals.steps)()?;
    // Free, and it is what keeps a re-install or a rescan of an already-tagged
    // library off the hours. Behind the same check as every other write: it is
    // the one row a dry run would otherwise leave behind.
    if opening.look_up && !plan.dry_run {
        lookup::seed_from_tags(&conn, crate::now_seconds())?;
    }
    let label = label(&opening);
    let context = Context {
        lock,
        transport,
        log,
        staging,
        signals,
        label: &label,
    };

    // Every release this run has visited. It is what makes the loop terminate
    // - the survey is a question about the library, not a cursor, so a release
    // that came back unchanged would come back forever - and it is what keeps
    // a permanent failure from being retried within the run, without a table
    // or a migration.
    let mut skip = plan.rehearsed.clone();
    let mut deferred: Vec<Pending> = Vec::new();
    let mut hobbled = false;
    let mut counted = false;

    loop {
        let steps = live_steps(&opening, signals, log, hobbled);
        if !steps.any() {
            break;
        }
        // Re-run per batch rather than once per sweep: a sweep runs for
        // forty-five hours, and a release retagged inside one has to be picked
        // up before it ends.
        let found = survey::survey(&conn, &steps, plan.batch, &skip)?;
        // Once a sweep. The fraction has to count towards a number that does
        // not move under it, and every later survey is missing the releases
        // this one has since got through.
        if !counted {
            plan.pace.begin(found.total);
            counted = true;
        }
        if found.batch.is_empty() {
            break;
        }

        for pending in found.batch {
            let key = lookup::fold(&pending.release.album, &pending.release.artist);
            skip.insert(key.clone());
            if plan.dry_run {
                plan.rehearsed.insert(key);
            }
            let steps = live_steps(&opening, signals, log, hobbled);
            match visit(&mut conn, &context, plan, &steps, &pending, &mut summary) {
                Visit::Next => {}
                Visit::Deferred => deferred.push(pending),
                Visit::LookupFailed => hobbled = true,
            }
        }
    }

    // The tail. Once, and then it waits for the next sweep: a release never
    // re-enters the survey mid-sweep, so an album left playing all evening
    // cannot spin the pass.
    for pending in deferred {
        let steps = live_steps(&opening, signals, log, hobbled);
        if steps.root.is_none() {
            break;
        }
        visit(&mut conn, &context, plan, &steps, &pending, &mut summary);
    }
    Ok(summary)
}

/// The switches as they stand, with whatever the sweep has learned folded in.
///
/// A switch that cannot be read leaves the steps as they were rather than
/// stopping the pass: a database busy for a moment is not the user changing
/// their mind, and if it is more than a moment the next write fails and ends
/// the sweep anyway. The line is so the log can tell the two apart.
fn live_steps(opening: &Steps, signals: &Signals<'_>, log: &Log, hobbled: bool) -> Steps {
    let mut steps = match (signals.steps)() {
        Ok(steps) => steps,
        Err(error) => {
            log.op("pass.switch").failed(&error);
            opening.clone()
        }
    };
    steps.look_up &= !hobbled;
    steps
}

/// One release: looked up if it needs it, then placed if it needs that.
///
/// **In that order, and the placement follows the lookup whatever the verdict:**
/// written, queued for review, or nothing found. A release the lookup could not
/// resolve is placed from its own tags with `Album` as the type, which is what
/// 83a already says such a release gets.
fn visit(
    conn: &mut Connection,
    context: &Context<'_>,
    plan: &mut Plan,
    steps: &Steps,
    pending: &Pending,
    summary: &mut Summary,
) -> Visit {
    let started = Instant::now();
    let mut release = pending.release.clone();
    let mut visit = Visit::Next;
    let mut attempted = false;
    let mut changed = false;

    if pending.look_up && steps.look_up {
        let op = context
            .log
            .op("lookup.release")
            .add("album", release.album.as_deref().unwrap_or("-"))
            .add("artist", release.artist.as_deref().unwrap_or("-"));
        let outcome = pass::look_up(
            conn,
            context.transport,
            context.lock,
            &release,
            context.staging,
            plan.dry_run,
            crate::now_seconds(),
        );
        if let Ok(outcome) = &outcome {
            summary.retries += outcome.retries;
        }
        // Logged by hand rather than through `Op::run_with`, because which of
        // the two this is - a line, or silence - is not known until the work
        // has run, and `Op::quiet` is decided before it does. 8,044 lines
        // about what was written is nothing next to a bad threshold that
        // cannot be diagnosed after the fact; 8,044 more about releases
        // MusicBrainz has never heard of is noise.
        match &outcome {
            Ok(Outcome {
                verdict: Verdict::NotFound,
                ..
            }) => {}
            Ok(outcome) => op.succeeded(outcome_fields(outcome, plan.dry_run)),
            Err(error) => op.failed(error),
        }

        match outcome.map(|outcome| outcome.verdict) {
            Ok(Verdict::Written { .. }) => {
                summary.resolved += 1;
                attempted = true;
                changed = !plan.dry_run;
                // The write put a new album and artist onto every file of the
                // release, so the key this release arrived under has stopped
                // naming it - and a move under that key would find no files.
                if !plan.dry_run {
                    if let Ok(Some((album, artist))) = query::release_of(conn, pending.track) {
                        release = lookup::Release { album, artist };
                    }
                }
            }
            Ok(Verdict::Queued { .. }) => {
                summary.queued += 1;
                attempted = true;
                changed = !plan.dry_run;
            }
            Ok(Verdict::NotFound) => {
                summary.missed += 1;
                attempted = true;
            }
            // A release that failed keeps no row, so a real pass tries it
            // again next sweep - right for a network that was down, harmless
            // for one that was not. Not counted: it wrote nothing, so counting
            // it would put the readout ahead of the library the next sweep
            // reads.
            Err(_) => visit = Visit::LookupFailed,
        }
    }

    if let (true, Some(root), Visit::Next) = (pending.place, steps.root.as_deref(), &visit) {
        let op = context
            .log
            .op("library.place")
            .add("album", release.album.as_deref().unwrap_or("-"))
            .add("artist", release.artist.as_deref().unwrap_or("-"));
        // A rehearsal that renamed the library would be the opposite of the
        // mode: it reports the move it would make and makes none.
        if plan.dry_run {
            op.succeeded(Fields::new().add("status", "would-move"));
            attempted = true;
        } else {
            match mover::move_release(
                conn,
                context.lock,
                &mover::OsRename,
                root,
                &release,
                &(context.signals.open)(),
            ) {
                Ok(mover::Outcome::Done(moved)) => {
                    summary.placed += 1;
                    attempted = true;
                    changed |= moved.files > 0 || moved.covers > 0;
                    op.succeeded(
                        Fields::new()
                            .add("status", "moved")
                            .add("files", moved.files)
                            .add("covers", moved.covers)
                            .add("skipped", moved.skipped),
                    );
                }
                Ok(mover::Outcome::Deferred) => {
                    summary.deferred += 1;
                    op.succeeded(Fields::new().add("status", "playing"));
                    visit = Visit::Deferred;
                }
                // Logged, skipped, and not offered again during this run: a
                // locked file must not end a four-hour backfill. Across sweeps
                // it is retried, which costs one attempt and one log line each
                // - the alternative is a status column, and a file the user
                // unlocks tomorrow is worth more than the noise.
                Err(error) => {
                    summary.unmovable += 1;
                    attempted = true;
                    op.failed(&error);
                }
            }
        }
    }

    // Once for the release rather than once per step: they are one visit, and
    // 82a coalesces on the emit side anyway.
    if changed {
        (context.signals.changed)();
    }
    if attempted {
        summary.visited += 1;
        (context.signals.progress)(&plan.pace.advance(started.elapsed(), context.label));
    }
    visit
}

/// What the readout calls a pass with these steps on.
fn label(steps: &Steps) -> String {
    match (steps.look_up, steps.root.is_some()) {
        (true, true) => "Looking up and filing releases",
        (true, false) => "Looking up releases",
        _ => "Filing releases",
    }
    .to_owned()
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
/// from being surveyed four times a minute, and a service that is down from
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
///
/// `retries` only when there were some, because there almost never are and a
/// `retries=0` on eight thousand lines says nothing.
fn outcome_fields(outcome: &Outcome, dry_run: bool) -> Fields {
    let fields = match &outcome.verdict {
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
    };
    if outcome.retries > 0 {
        fields.add("retries", outcome.retries)
    } else {
        fields
    }
}

/// The two switches, as one answer.
pub fn steps(conn: &Connection) -> AppResult<Steps> {
    Ok(Steps {
        look_up: settings::unattended_lookup(conn)?,
        root: settings::library_root(conn)?,
    })
}

/// Starts the `library-pass` thread.
///
/// Started unconditionally and inert until a switch is on: the thread reads
/// both on every wake, so turning one on needs no restart and turning it off
/// cancels its step in a pass that is running.
///
/// `on_change` runs per release written, queued or moved, not per sweep: a
/// sweep is hours long and may not end at all. A release MusicBrainz has never
/// heard of says nothing to the window, and neither does a dry run - nothing a
/// view draws changed.
///
/// `on_progress` is the readout at the foot of the sidebar, told per release
/// attempted and told `None` when the sweep ends, whatever ended it.
pub fn spawn(
    db: Db,
    lock: ScanLock,
    log: Log,
    staging: PathBuf,
    open: impl Fn() -> HashSet<i64> + Send + 'static,
    on_change: impl Fn() + Send + 'static,
    on_progress: impl Fn(Option<&BackgroundTask>) + Send + 'static,
) {
    let _ = std::thread::Builder::new()
        .name("library-pass".to_owned())
        .spawn(move || {
            // The rehearsal's place lives out here, so a sweep a 503 ended
            // does not send the survey back to the first release. A real pass
            // never touches it.
            let mut plan = Plan::from_env();
            // How long to leave between sweeps, as against between wakes. It
            // doubles while there is nothing to do and snaps back the moment
            // there is.
            let mut quiet = TICK;
            let mut due = Instant::now();

            loop {
                std::thread::sleep(TICK);

                // One connection for the whole sweep rather than one per
                // release: the switches are read thousands of times and
                // opening a database to read two rows is most of what that
                // costs.
                let switches = match db.conn() {
                    Ok(conn) => conn,
                    Err(error) => {
                        log.op("pass.switch").failed(&error);
                        continue;
                    }
                };
                let read = || steps(&switches);
                match read() {
                    Ok(steps) if steps.any() => {}
                    Ok(_) => continue,
                    Err(error) => {
                        log.op("pass.switch").failed(&error);
                        continue;
                    }
                }
                // The switches are answered every wake; the library is not
                // asked until a sweep is due.
                if Instant::now() < due {
                    continue;
                }
                let Some(transport) = crate::tagsource::transport::shared() else {
                    continue;
                };

                let op = log.op("pass.sweep");
                let summary = sweep(
                    &db,
                    &lock,
                    transport,
                    &log,
                    &staging,
                    &mut plan,
                    &Signals {
                        steps: &read,
                        changed: &on_change,
                        progress: &|task| on_progress(Some(task)),
                        open: &open,
                    },
                );
                // Whatever ended it - a finished library, a switch, a 503 -
                // there is no longer a task to report on.
                on_progress(None);

                let visited = summary.as_ref().map_or(0, |summary| summary.visited);
                quiet = next_sweep(quiet, visited);
                due = Instant::now() + quiet;

                match &summary {
                    Ok(summary) => op.succeeded(
                        Fields::new()
                            .add("visited", summary.visited)
                            .add("resolved", summary.resolved)
                            .add("queued", summary.queued)
                            .add("missed", summary.missed)
                            .add("placed", summary.placed)
                            .add("deferred", summary.deferred)
                            .add("unmovable", summary.unmovable)
                            .add("retries", summary.retries)
                            .add("next", format!("{}s", quiet.as_secs())),
                    ),
                    Err(error) => op.failed(error),
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tagsource::pass::tests::{add_release, library, musicbrainz, LOVELESS_DURATIONS};
    use crate::tagsource::transport::FakeTransport;
    use std::cell::{Cell, RefCell};

    /// A real pass over whole batches, which is every test here but the ones
    /// about paging.
    fn live() -> Plan {
        Plan {
            dry_run: false,
            batch: BATCH,
            ..Plan::default()
        }
    }

    /// A dry run reading one release at a time, so that a second batch is
    /// reached without a library of two hundred of them.
    fn dry() -> Plan {
        Plan {
            dry_run: true,
            batch: 1,
            ..Plan::default()
        }
    }

    fn looking_up() -> Steps {
        Steps {
            look_up: true,
            root: None,
        }
    }

    fn filing(root: &Path) -> Steps {
        Steps {
            look_up: false,
            root: Some(root.to_path_buf()),
        }
    }

    fn both(root: &Path) -> Steps {
        Steps {
            look_up: true,
            root: Some(root.to_path_buf()),
        }
    }

    /// Switches held where they are, which is every test here but the ones
    /// that flip one.
    fn held(steps: Steps) -> impl Fn() -> AppResult<Steps> {
        move || Ok(steps.clone())
    }

    /// A sweep nobody is watching, for the tests that assert what it did
    /// rather than what it announced.
    fn unwatched<'a>(steps: &'a dyn Fn() -> AppResult<Steps>) -> Signals<'a> {
        Signals {
            steps,
            changed: &|| {},
            progress: &|_| {},
            open: &|| HashSet::new(),
        }
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

    fn root_of(dir: &Path) -> PathBuf {
        dir.join("Library")
    }

    /// What a sweep would still find to do. Nothing left is what "placed"
    /// means, drawn from the same survey the pass runs on.
    fn left(db: &Db, steps: &Steps) -> usize {
        survey::survey(&db.conn().unwrap(), steps, 100, &HashSet::new())
            .unwrap()
            .total
    }

    /// Every row's path, so a test can say what moved without knowing the
    /// layout by heart.
    fn paths(db: &Db) -> Vec<String> {
        let conn = db.conn().unwrap();
        let mut stmt = conn
            .prepare("SELECT path FROM tracks ORDER BY path")
            .unwrap();
        let rows = stmt.query_map([], |row| row.get::<_, String>(0)).unwrap();
        rows.collect::<rusqlite::Result<_>>().unwrap()
    }

    fn run(db: &Db, dir: &Path, plan: &mut Plan, signals: &Signals<'_>) -> Summary {
        sweep(
            db,
            &ScanLock::default(),
            &musicbrainz(),
            &log_to(dir),
            dir,
            plan,
            signals,
        )
        .unwrap()
    }

    /// The whole of one pass, not two: the release is searched, written and
    /// then moved to where the tags the search wrote say it goes - which is a
    /// different folder than the tags it arrived with named.
    #[test]
    fn a_release_is_looked_up_and_placed_in_one_visit() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        let root = root_of(dir.path());
        let steps = both(&root);

        let summary = run(
            &db,
            dir.path(),
            &mut live(),
            &unwatched(&held(steps.clone())),
        );

        assert_eq!(summary.resolved, 1);
        assert_eq!(summary.placed, 1);
        assert!(
            paths(&db)
                .iter()
                .all(|path| Path::new(path).starts_with(&root)),
            "a file was left outside the library folder"
        );
        assert_eq!(left(&db, &steps), 0);
    }

    /// A release MusicBrainz could not settle is still filed, from its own
    /// tags. Waiting for an identity that is never coming is a release that
    /// never moves.
    #[test]
    fn a_release_the_lookup_could_not_resolve_is_placed_anyway() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        let root = root_of(dir.path());
        let steps = both(&root);
        // Every search comes back empty, which is the one answer MusicBrainz
        // gives with a 200 and nothing in it, so the release is a miss.
        let summary = sweep(
            &db,
            &ScanLock::default(),
            &FakeTransport::new().answering("/ws/2/release", r#"{"releases":[]}"#),
            &log_to(dir.path()),
            dir.path(),
            &mut live(),
            &unwatched(&held(steps.clone())),
        )
        .unwrap();

        assert_eq!(summary.resolved, 0);
        assert_eq!(summary.placed, 1);
        assert_eq!(left(&db, &steps), 0);
    }

    /// The survey is the whole resume mechanism: a filed library is filed, and
    /// asking again costs the walk and no filesystem calls at all.
    #[test]
    fn a_second_sweep_moves_nothing_and_repeats_no_work() {
        let (dir, db) = two_releases();
        let root = root_of(dir.path());
        let steps = both(&root);

        let first = run(
            &db,
            dir.path(),
            &mut live(),
            &unwatched(&held(steps.clone())),
        );
        assert_eq!(first.visited, 2);
        let settled = paths(&db);

        let again = run(
            &db,
            dir.path(),
            &mut live(),
            &unwatched(&held(steps.clone())),
        );

        assert_eq!(again.visited, 0);
        assert_eq!(paths(&db), settled);
    }

    /// A pass cut short - a quit, a switch, a 503 - leaves the library as its
    /// own cursor. The second sweep does what the first did not and does not
    /// redo what it did.
    #[test]
    fn a_cancelled_sweep_resumes_where_it_stopped() {
        let (dir, db) = two_releases();
        let root = root_of(dir.path());
        let steps = both(&root);

        // Off after the first release: this closure is what the switches flip.
        let seen = Cell::new(0);
        let cancelling = || {
            let before = seen.get();
            seen.set(before + 1);
            // Once to open the sweep, once for the batch, then once per
            // release - so the third call is what the first release runs on
            // and the fourth is where the switch finds the second.
            Ok(if before < 3 {
                steps.clone()
            } else {
                Steps::default()
            })
        };
        let first = run(&db, dir.path(), &mut live(), &unwatched(&cancelling));
        assert_eq!(first.visited, 1);

        let second = run(
            &db,
            dir.path(),
            &mut live(),
            &unwatched(&held(steps.clone())),
        );

        assert_eq!(
            second.visited, 1,
            "the second sweep does the release the first did not, and not the one it did"
        );
        assert_eq!(left(&db, &steps), 0);
    }

    /// Each switch cancels its own step and leaves the other running, which is
    /// what makes them two settings rather than one.
    #[test]
    fn a_switch_going_off_stops_its_own_step_and_not_the_other() {
        let (dir, db) = two_releases();
        let root = root_of(dir.path());

        let filing_only = run(
            &db,
            dir.path(),
            &mut live(),
            &unwatched(&held(filing(&root))),
        );
        assert_eq!(filing_only.placed, 2);
        assert_eq!(
            filing_only.resolved + filing_only.queued + filing_only.missed,
            0
        );

        let looking_only = run(
            &db,
            dir.path(),
            &mut live(),
            &unwatched(&held(looking_up())),
        );
        assert_eq!(looking_only.visited, 2);
        assert_eq!(looking_only.placed, 0);
    }

    /// A locked file must not end a four-hour backfill, and it must not be
    /// tried again for the length of one either.
    #[test]
    fn a_release_that_will_not_move_is_passed_over_once() {
        let (dir, db) = two_releases();
        let root = root_of(dir.path());
        let steps = filing(&root);

        // The file is gone from disk but its row does not know it, which is
        // what a rename fails on. A row marked missing would be skipped
        // instead, which is the other thing entirely.
        let gone = paths(&db).into_iter().next().unwrap();
        std::fs::remove_file(&gone).unwrap();

        let summary = run(
            &db,
            dir.path(),
            &mut live(),
            &unwatched(&held(steps.clone())),
        );

        assert_eq!(summary.unmovable, 1, "and only once, not once per survey");
        assert_eq!(summary.placed, 1, "the sweep carried on to the other one");
    }

    /// The playing release goes to a tail rather than being dropped: a user
    /// who leaves one album on must not find it the only one left behind.
    #[test]
    fn the_playing_release_is_tried_again_at_the_end_of_the_sweep() {
        let (dir, db) = two_releases();
        let root = root_of(dir.path());
        let steps = filing(&root);

        // Held open until the tail. `move_release` reads this per release, so
        // releasing it after the batch is what the tail then finds.
        let held_open: RefCell<HashSet<i64>> = RefCell::new(
            db.conn()
                .unwrap()
                .prepare("SELECT id FROM tracks ORDER BY path LIMIT 1")
                .unwrap()
                .query_map([], |row| row.get::<_, i64>(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap(),
        );
        let asked = Cell::new(0);
        let open = || {
            asked.set(asked.get() + 1);
            // Two releases in the batch, and the third ask is the tail.
            if asked.get() > 2 {
                held_open.borrow_mut().clear();
            }
            held_open.borrow().clone()
        };

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &musicbrainz(),
            &log_to(dir.path()),
            dir.path(),
            &mut live(),
            &Signals {
                steps: &held(steps.clone()),
                changed: &|| {},
                progress: &|_| {},
                open: &open,
            },
        )
        .unwrap();

        assert_eq!(summary.deferred, 1, "it was left alone while it played");
        assert_eq!(summary.placed, 2, "and moved by the tail");
        assert_eq!(left(&db, &steps), 0);
    }

    /// A rehearsal that renamed the library would be the opposite of the mode.
    #[test]
    fn a_dry_run_moves_no_files() {
        let (dir, db) = two_releases();
        let root = root_of(dir.path());
        let before = paths(&db);

        let summary = run(&db, dir.path(), &mut dry(), &unwatched(&held(both(&root))));

        assert!(summary.resolved > 0, "it reached the verdicts");
        assert_eq!(summary.placed, 0);
        assert_eq!(paths(&db), before);
        assert!(!root.exists(), "it did not even make the folder");
    }

    /// The assertion whose absence let a dry run ship that could only ever
    /// report on its first batch: it writes nothing and moves nothing, so
    /// without a place of its own every survey hands it the same release.
    #[test]
    fn a_dry_run_reaches_the_second_batch() {
        let (dir, db) = two_releases();
        let root = root_of(dir.path());

        let summary = run(&db, dir.path(), &mut dry(), &unwatched(&held(both(&root))));

        assert_eq!(
            summary.visited, 2,
            "each release once, which means the second batch was read"
        );
    }

    /// A dry run writes nothing at all, and the seed is the one write that is
    /// not a verdict.
    #[test]
    fn a_dry_run_leaves_the_table_empty_seed_included() {
        let (dir, db) = two_releases();
        db.conn()
            .unwrap()
            .execute("UPDATE tracks SET release_mbid = 'bb5a'", [])
            .unwrap();

        run(&db, dir.path(), &mut dry(), &unwatched(&held(looking_up())));

        assert_eq!(
            db.conn()
                .unwrap()
                .query_row("SELECT count(*) FROM release_lookup", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
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
            &unwatched(&held(looking_up())),
        )
        .unwrap();

        assert_eq!(summary.visited, 0);
        assert_eq!(transport.call_count(), 0);
    }

    /// The view has to hear about a release while the pass is running, not
    /// when it stops. A sweep is hours long and may not stop at all.
    ///
    /// Once per release however many steps ran on it: the two are one visit.
    #[test]
    fn every_release_the_pass_touched_tells_the_window_once() {
        let (dir, db) = two_releases();
        let root = root_of(dir.path());
        let told = Cell::new(0);

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &musicbrainz(),
            &log_to(dir.path()),
            dir.path(),
            &mut live(),
            &Signals {
                steps: &held(both(&root)),
                changed: &|| told.set(told.get() + 1),
                progress: &|_| {},
                open: &|| HashSet::new(),
            },
        )
        .unwrap();

        assert_eq!(summary.placed, 2, "both were looked up and both moved");
        assert_eq!(told.get(), 2, "once each, not once per step");
    }

    /// One percent of a real pass is eighty releases and the better part of
    /// half an hour, so the readout has to move per release or it reads as
    /// hung - and it has to count towards a total it can reach.
    #[test]
    fn the_readout_counts_up_to_what_the_survey_found() {
        let (dir, db) = two_releases();
        let root = root_of(dir.path());
        let seen = RefCell::new(Vec::new());

        sweep(
            &db,
            &ScanLock::default(),
            &musicbrainz(),
            &log_to(dir.path()),
            dir.path(),
            &mut live(),
            &Signals {
                steps: &held(both(&root)),
                changed: &|| {},
                progress: &|task| seen.borrow_mut().push(task.clone()),
                open: &|| HashSet::new(),
            },
        )
        .unwrap();

        let seen = seen.into_inner();
        assert_eq!(
            seen.iter().map(|task| task.done).collect::<Vec<_>>(),
            [1, 2]
        );
        assert!(seen.iter().all(|task| task.total == 2));
    }

    /// The label names the steps that are on, and does not change during a
    /// run: one that rewrote itself mid-sweep would read as a second task
    /// starting.
    #[test]
    fn the_label_names_the_steps_that_are_on() {
        assert_eq!(label(&looking_up()), "Looking up releases");
        assert_eq!(label(&filing(Path::new("D:\\Music"))), "Filing releases");
        assert_eq!(
            label(&both(Path::new("D:\\Music"))),
            "Looking up and filing releases"
        );
    }

    #[test]
    fn there_is_no_estimate_until_there_is_history_to_draw_one_from() {
        let mut pace = Pace {
            done: 0,
            total: 10,
            recent: VecDeque::new(),
        };

        assert_eq!(pace.advance(Duration::from_secs(20), "x").eta_ms, None);
        assert_eq!(pace.advance(Duration::from_secs(20), "x").eta_ms, None);
        assert_eq!(
            pace.advance(Duration::from_secs(20), "x").eta_ms,
            Some(7 * 20_000),
            "seven releases left at twenty seconds each"
        );
    }

    /// The rate is not steady - a release whose files already carry an MBID
    /// costs nothing and a searched one costs two rate-limited requests - so
    /// an average over the whole pass describes a pass that is not running.
    #[test]
    fn the_estimate_forgets_a_rate_the_pass_has_left_behind() {
        let mut pace = Pace {
            done: 0,
            total: 3 * RECENT,
            recent: VecDeque::new(),
        };

        // A hundred instant releases, the way a library Picard already tagged
        // starts, and then a hundred at the rate the pass actually runs at.
        for _ in 0..RECENT {
            pace.advance(Duration::ZERO, "x");
        }
        for _ in 0..RECENT {
            pace.advance(Duration::from_secs(20), "x");
        }

        assert_eq!(pace.recent.len(), RECENT);
        assert_eq!(
            pace.eta(),
            Some(RECENT as i64 * 20_000),
            "a hundred left at twenty seconds each - the free ones are gone"
        );
    }

    /// The pass spends most of its life over a finished library, and a sweep
    /// over one sorts every row in `tracks`.
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
}
