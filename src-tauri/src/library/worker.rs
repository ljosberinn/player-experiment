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
//! backfill behind ninety hours of lookups, no gate moves 8,044 releases
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
use crate::error::{AppError, AppResult};
use crate::library::mover;
use crate::library::survey::{self, Pending, Steps};
use crate::log::{Fields, Log};
use crate::model::BackgroundTask;
use crate::scan::ScanLock;
use crate::tagsource::pass::{self, Outcome, Verdict};
use crate::tagsource::transport::{Transport, TransportError};

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

/// How many lookups the service did not answer may fail in a row before the
/// step is parked for the sweep.
///
/// Three releases exhausting three attempts each is nine consecutive requests
/// nothing replied to, over three minutes at the limiter's pace. The number
/// does not have to clear a distribution, because [`declined`] keeps the one
/// failure that has one out of the run - what is counted here is unambiguous,
/// so a run of three is already an outage rather than a tail.
const OUTAGE: usize = 3;

/// How many releases are taken from one survey.
///
/// The survey sorts every row of `tracks`, so asking for one release at a time
/// would spend a pass that already takes hours sorting that table eight
/// thousand times. Large enough to amortise it, small enough that a release
/// retagged mid-pass is picked up within a batch.
const BATCH: usize = 200;

/// How many releases a sweep gets through between `pass.progress` lines.
///
/// Counted in releases rather than minutes because that is what bounds the
/// file: a pass writes at most one line per this many releases whatever its
/// pace - eighty over 8,008 - and a sweep with nothing to do gets through none
/// and writes none. A minute cadence would be spent against the ninety
/// sweep-hours instead.
const PROGRESS: usize = 100;

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
    /// surveying its first batch over and over. It survives a sweep that ended
    /// early, and it does not survive the process: a rehearsal is one sitting.
    pub rehearsed: HashSet<lookup::Key>,
    /// What the readout is told, and what it takes to say it.
    pub pace: Pace,
    /// Lookups the service did not answer, since the last one to reach a
    /// verdict. Declines are neither counted nor cleared here - see
    /// [`declined`].
    ///
    /// Here rather than in the sweep, for the reason the pace is: a run that
    /// dies with the sweep it parked cannot tell an outage from a burst. Every
    /// sweep would open the count at zero, and `next_sweep` returns [`TICK`]
    /// while there is placement work, so a network that is down would be asked
    /// again fifteen seconds later for another [`OUTAGE`] failed lookups.
    ///
    /// Only the count carries. Parking is a local of the sweep, so each one
    /// probes with a single lookup: a verdict clears the run, a failure parks
    /// it again.
    pub failures: usize,
    /// How many releases apart the `pass.progress` lines are, or zero for
    /// none.
    ///
    /// Here rather than a constant read at the site, for the reason [`Plan::batch`]
    /// is: a test has to reach a second line without a library of a hundred
    /// releases.
    pub progress_every: usize,
}

impl Plan {
    /// What the thread runs with.
    pub fn from_env() -> Self {
        Self {
            dry_run: pass::dry_run(),
            batch: BATCH,
            progress_every: PROGRESS,
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
    /// releases at the end of a ninety-hour pass has not been told. Once
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
/// rehearsal's place is: a sweep that ended early would otherwise throw away
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
    ///
    /// Once per release however many drains it stayed open for: this is a
    /// state the sweep found the library in rather than a cost it paid, and an
    /// album left on all evening is one album.
    pub deferred: usize,
    /// Releases a move failed on - a locked file, a full disk.
    pub unmovable: usize,
    /// Lookups that exhausted their three attempts, declined or not.
    ///
    /// Lookups rather than releases, and a release the drain asks again counts
    /// twice: this is what the pass paid, and a second visit is three more
    /// requests. `deferred` beside it is the counter that is a state.
    ///
    /// How much a pass is paying for a service that is declining, which the
    /// `run` beside it no longer says at all: a decline never reaches the run.
    /// The two read together - `failed` high against `run` at zero is a busy
    /// MusicBrainz and nothing else. A release that failed returns an error
    /// rather than an outcome, so its `retries` are lost and it is not counted
    /// in `visited` either.
    pub failed: usize,
    /// How many requests this sweep had to ask again before one was answered.
    ///
    /// The only measure of how much throttling a pass is absorbing. A retry
    /// that works leaves no other trace: the release resolves, and the five
    /// seconds it cost read as a slow request.
    pub retries: usize,
    /// The longest run of unanswered lookups, which is what [`OUTAGE`] is read
    /// back against.
    ///
    /// `failed` cannot stand in for it, and neither can the log: the run is
    /// what the threshold is, and a `NotFound` verdict resets it without
    /// writing a line, so runs counted off `lookup.release` are longer than
    /// the ones the sweep parked on. Expected to sit at zero - every failure
    /// this library has ever recorded was a decline.
    pub run: usize,
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

/// What one release came to, and what it is called now.
struct Visited {
    outcome: Visit,
    /// The album and artist the release carries after the visit, which is the
    /// pair it arrived with unless a lookup rewrote its tags.
    ///
    /// **The key the sweep has to remember is this one, not the one the
    /// release arrived under.** A rewritten release stops answering to the key
    /// the survey found it by, so a `skip` holding only that key hands the
    /// same release back in the next batch - a second search for a release
    /// that is already resolved. It is what the drain has to move the release
    /// under, too: the name it arrived with names no files any more.
    release: lookup::Release,
}

/// What one release came to, from the sweep's point of view.
enum Visit {
    /// On to the next one.
    Next,
    /// The player holds a file of it open. Tried again at the end of every
    /// batch until it is not, rather than dropped: a user who leaves one album
    /// on must not find it the only one left behind, and the wait is a track's
    /// rather than a sweep's.
    Deferred,
    /// The lookup exhausted its three attempts against a MusicBrainz that
    /// declined every one. The release is retried by the drain at the end of
    /// the batch and then left to the next sweep, and the sweep carries on
    /// through the batch: a 503 says nothing about the next request in either
    /// direction, so it neither counts towards the run nor clears it. See
    /// [`declined`].
    Declined,
    /// The lookup exhausted its three attempts on something that was not an
    /// answer. Deferred the same way, but counted: a run of [`OUTAGE`] parks
    /// the step - the *step*, not the sweep, because a network that is down
    /// says nothing about moving files.
    LookupFailed,
}

/// Whether a failed lookup is MusicBrainz declining rather than a failure to
/// reach it.
///
/// **Only a 503.** It is the documented code for a full bucket, and
/// `tagsource::rate` records why the client cannot tell whose bucket it was:
/// the limit is enforced from three of them at once, so a client well inside
/// its own allowance still meets 503s. Nothing can be read off one, so it is
/// kept out of the run entirely.
///
/// Every other status stays in. [`TransportError::Server`] also covers a
/// gateway, a captive portal and a 5xx page, none of which is MusicBrainz
/// answering and all of which would go on answering the same way - a proxy
/// stuck on 502 is exactly the outage [`OUTAGE`] exists to stop. So does every
/// error that is not the transport's: a locked database says as much about the
/// next release as an unreachable host does.
fn declined(error: &AppError) -> bool {
    matches!(
        error,
        AppError::Network(TransportError::Server { status: 503, .. })
    )
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
    // The two deferrals, apart because they are bounded by different things.
    //
    // `playing` is bounded by the player: `(signals.open)()` is the playing
    // track and the prepared next, so a drain sheds every entry but the one
    // open at that moment, and an entry may go back on it as often as it
    // likes. `declined` has no such bound - a service that goes on declining
    // offers a quarter of every batch - so an entry there is retried once and
    // then left to the next sweep.
    let mut playing: Vec<Pending> = Vec::new();
    let mut declined: Vec<Pending> = Vec::new();
    // `plan.failures` carries whatever the run stood at when the last sweep
    // ended; parking does not, so this one probes before it believes it.
    let mut hobbled = false;
    let mut counted = false;
    // Releases this sweep has been through, whatever came of them - which is
    // not `summary.visited`, because a release whose lookup failed is not
    // counted there and a cadence on it would go quiet during exactly the
    // failure these lines exist to record.
    let mut seen = 0;

    loop {
        let steps = live_steps(&opening, signals, log, hobbled);
        if !steps.any() {
            break;
        }
        // Re-run per batch rather than once per sweep: a sweep runs for
        // ninety hours, and a release retagged inside one has to be picked
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
            // What resets the run: a lookup that ran and did not fail. Not
            // `Visit::Next`, which a release with no lookup left to do returns
            // as well - a batch of those between two failures would clear the
            // count and a real outage would never reach the threshold.
            let looked_up = pending.look_up && steps.look_up;
            let visited = visit(
                &mut conn,
                &context,
                plan,
                &steps,
                &pending,
                false,
                &mut summary,
            );
            // Under the name it has now as well as the one it arrived with: a
            // lookup that rewrote the tags left the release answering to a key
            // the survey has not been told about, and the next batch would
            // offer it again.
            skip.insert(lookup::fold(
                &visited.release.album,
                &visited.release.artist,
            ));
            match visited.outcome {
                Visit::Next => {
                    if looked_up {
                        plan.failures = 0;
                    }
                }
                // Its lookup is done, so the drain must not run it again: it
                // would search on tags nothing carries any more. The refreshed
                // release rather than `pending`'s for the same reason - the
                // drain has to move it under the name it has now.
                Visit::Deferred => {
                    if looked_up {
                        plan.failures = 0;
                    }
                    playing.push(Pending {
                        look_up: false,
                        release: visited.release,
                        ..pending
                    });
                }
                // The service answered, so there is nothing here to learn
                // about the next release - the run is left exactly where it
                // stood rather than advanced or cleared.
                Visit::Declined => declined.push(pending),
                Visit::LookupFailed => {
                    plan.failures += 1;
                    summary.run = summary.run.max(plan.failures);
                    hobbled = plan.failures >= OUTAGE;
                    declined.push(pending);
                }
            }
            seen += 1;
            note_progress(log, seen, plan.progress_every, &summary);
        }

        // The drain, at the end of every batch rather than at the end of the
        // sweep: a sweep runs the library to exhaustion now, so a tail is
        // ninety hours away from the release it is holding, and the mover's
        // deferral is a wait of minutes.
        //
        // One rule for both lists, because the asymmetry is in which outcomes
        // can happen twice rather than in the rule - whatever is still playing
        // goes back on, and everything else is done with for this sweep. A
        // release that declines a second time is therefore dropped, and it
        // keeps no row, so the next sweep has it back.
        //
        // Nothing here touches `plan.failures`: a second opinion about a
        // release the batch already counted says nothing more about the
        // network than the first one did.
        let again = std::mem::take(&mut playing);
        let once = std::mem::take(&mut declined);
        for (pending, announced) in again
            .into_iter()
            .map(|pending| (pending, true))
            .chain(once.into_iter().map(|pending| (pending, false)))
        {
            let steps = live_steps(&opening, signals, log, hobbled);
            // Either step, not the mover's alone: the list carries releases a
            // 503 deferred, and a lookup-only pass would never reach its own.
            if !steps.any() {
                break;
            }
            // **A release whose lookup could not reach it is not placed.**
            // `visit` already refuses that behind `Visit::Next`, and the drain
            // has to keep refusing it, or a 503 would file the release under
            // the tags the lookup was about to replace and the next sweep
            // would move it again.
            if pending.look_up && !steps.look_up {
                continue;
            }
            let visited = visit(
                &mut conn,
                &context,
                plan,
                &steps,
                &pending,
                announced,
                &mut summary,
            );
            if matches!(visited.outcome, Visit::Deferred) {
                playing.push(Pending {
                    look_up: false,
                    release: visited.release,
                    ..pending
                });
            }
            seen += 1;
            note_progress(log, seen, plan.progress_every, &summary);
        }
    }
    Ok(summary)
}

/// What the sweep has counted so far, every [`Plan::progress_every`] releases.
///
/// **The counters have to leave the sweep before the sweep does.** They live on
/// a [`Summary`] built per sweep and on a [`Plan`] owned by the pass thread, so
/// a process that dies mid-sweep takes all of them - and now that a sweep runs
/// the library to exhaustion rather than parking on a 503, that is ninety hours
/// against a process restarted about daily. `pass.sweep` would be a line that
/// never arrives.
///
/// [`Log::note`] rather than [`Log::op`]: an `Op` measures `ms` from the moment
/// it is created, and one created to be finished in the same statement would
/// write `ms=0` onto every line.
fn note_progress(log: &Log, seen: usize, every: usize, summary: &Summary) {
    if every == 0 || !seen.is_multiple_of(every) {
        return;
    }
    log.note(
        "pass.progress",
        Fields::new()
            .add("visited", summary.visited)
            .add("failed", summary.failed)
            .add("retries", summary.retries)
            .add("run", summary.run),
    );
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
///
/// `announced` says this release's deferral has already been counted and
/// written down - it is on the drain's `playing` list. A deferral is a state
/// rather than a cost, so it is one of each per release however many drains
/// the release goes through: an album left on all evening would otherwise
/// report as hundreds and write a `library.place` line per batch for ninety
/// hours.
fn visit(
    conn: &mut Connection,
    context: &Context<'_>,
    plan: &mut Plan,
    steps: &Steps,
    pending: &Pending,
    announced: bool,
    summary: &mut Summary,
) -> Visited {
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
            // for one that was not. Not counted in `visited`: it wrote
            // nothing, so counting it would put the readout ahead of the
            // library the next sweep reads.
            Err(error) => {
                summary.failed += 1;
                visit = if declined(&error) {
                    Visit::Declined
                } else {
                    Visit::LookupFailed
                };
            }
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
                    if !announced {
                        summary.deferred += 1;
                        op.succeeded(Fields::new().add("status", "playing"));
                    }
                    visit = Visit::Deferred;
                }
                // Nothing carries the name any more - the release was removed
                // while the sweep ran. Not counted in `placed`, which would
                // otherwise report a library filed that nothing was done to.
                Ok(mover::Outcome::Absent) => {
                    attempted = true;
                    op.succeeded(Fields::new().add("status", "absent"));
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
    Visited {
        outcome: visit,
        release,
    }
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
/// `retries=0` on eight thousand lines says nothing. `sole` the same, and it
/// is what makes the `score` readable: a write carrying it cleared the bar on
/// the search score, so its `score` - the fetched one - is below the
/// threshold, and without the field a tuning pass would read a broken bar.
fn outcome_fields(outcome: &Outcome, dry_run: bool) -> Fields {
    let fields = match &outcome.verdict {
        Verdict::Written {
            mbid,
            score,
            tracks,
            sole,
        } => {
            let fields = Fields::new()
                .add("status", if dry_run { "would-write" } else { "written" })
                .add("mbid", mbid)
                .add("score", format!("{score:.3}"))
                .add("tracks", tracks);
            // Only where it is true, and for the same reason as `retries`:
            // almost every line is a `false` that says nothing.
            if *sole {
                fields.add("sole", true)
            } else {
                fields
            }
        }
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
            // The rehearsal's place lives out here, so a sweep that ended
            // early does not send the survey back to the first release. A real
            // pass never touches it.
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
                // Whatever ended it - a finished library, a switch, an outage -
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
                            .add("failed", summary.failed)
                            .add("retries", summary.retries)
                            .add("run", summary.run)
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
    use crate::tagsource::pass::tests::{
        add_release, flaky, library, musicbrainz, LOVELESS_DURATIONS,
    };
    use crate::tagsource::transport::{FakeTransport, TransportError};
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

    /// Three releases whose path order and survey order agree, so a test that
    /// holds the first track open holds the release the first batch is given.
    ///
    /// `two_releases` cannot do it: it writes `Loveless` first and the survey
    /// reads `Isn't Anything` first, which is fine for a batch of both and
    /// wrong for a batch of one.
    fn three_releases() -> (tempfile::TempDir, Db) {
        let (dir, db) = library("Isn't Anything", "My Bloody Valentine", &LOVELESS_DURATIONS);
        for album in ["Loveless", "Tremolo"] {
            add_release(
                &db,
                dir.path(),
                album,
                "My Bloody Valentine",
                &LOVELESS_DURATIONS,
            );
        }
        (dir, db)
    }

    /// One release at a time, so a drain lands between two batches rather than
    /// at the end of the only one.
    fn paged() -> Plan {
        Plan { batch: 1, ..live() }
    }

    /// `count` releases, all answerable by the same fixtures and all named
    /// apart, so the survey hands them over one at a time.
    fn releases(count: usize) -> (tempfile::TempDir, Db) {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        for n in 1..count {
            add_release(
                &db,
                dir.path(),
                &format!("Loveless {n}"),
                "My Bloody Valentine",
                &LOVELESS_DURATIONS,
            );
        }
        (dir, db)
    }

    /// A MusicBrainz that declines everything, which is what a release
    /// exhausts its three attempts against.
    fn declining() -> FakeTransport {
        answering_with(503)
    }

    /// A MusicBrainz that cannot be reached at all - the only shape of failure
    /// the run counts.
    fn unanswered() -> FakeTransport {
        FakeTransport::new().failing(
            "/ws/2/release",
            TransportError::Unreachable {
                host: "musicbrainz.org".to_owned(),
                message: "no route to host".to_owned(),
            },
        )
    }

    fn answering_with(status: u16) -> FakeTransport {
        FakeTransport::new().failing(
            "/ws/2/release",
            TransportError::Server {
                host: "musicbrainz.org".to_owned(),
                status,
            },
        )
    }

    /// How many searches a sweep made, as against fetches and covers: the
    /// search URL is the one with no trailing segment after it.
    fn searches(transport: &FakeTransport) -> usize {
        transport
            .calls()
            .iter()
            .filter(|call| call.url.ends_with("/ws/2/release"))
            .count()
    }

    /// The first `tracks` rows by path, which for these fixtures is the front
    /// of the first release the survey offers.
    fn leading_tracks(db: &Db, tracks: usize) -> HashSet<i64> {
        db.conn()
            .unwrap()
            .prepare("SELECT id FROM tracks ORDER BY path LIMIT ?1")
            .unwrap()
            .query_map([tracks as i64], |row| row.get::<_, i64>(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    /// The tracks the player holds a `std::fs::File` on: the first `tracks` of
    /// them, let go once `asks` releases have been through the mover.
    ///
    /// `move_release` reads this once per release, so the ask after the batch
    /// is the drain's - which is what puts a release on the list and finds it
    /// free when the drain gets to it.
    fn held_until(db: &Db, tracks: usize, asks: usize) -> impl Fn() -> HashSet<i64> {
        let held: RefCell<HashSet<i64>> = RefCell::new(leading_tracks(db, tracks));
        let asked = Cell::new(0);
        move || {
            asked.set(asked.get() + 1);
            if asked.get() > asks {
                held.borrow_mut().clear();
            }
            held.borrow().clone()
        }
    }

    fn log_to(dir: &Path) -> Log {
        Log::to(dir.join("apex.log"))
    }

    /// The lines one operation left behind, oldest first.
    ///
    /// The order is the assertion in most of these: whether a release was
    /// retried at the end of its batch or at the end of the sweep is not
    /// visible in any counter, and it is the whole of what a drain changes.
    fn lines_of(dir: &Path, op: &str) -> Vec<String> {
        std::fs::read_to_string(dir.join("apex.log"))
            .unwrap_or_default()
            .lines()
            .filter(|line| line.contains(op))
            .map(str::to_owned)
            .collect()
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

    /// A release the lookup renames stops answering to the key the survey
    /// found it by, so a run that remembered only that key would be handed the
    /// same release in the next batch - and search it again, on a pass that
    /// pays the rate limiter for every request.
    #[test]
    fn a_release_the_lookup_renamed_is_not_surveyed_again() {
        // A name MusicBrainz replaces: the write lands as "Loveless" by
        // "My Bloody Valentine", which is a key the survey has not been told
        // about.
        let (dir, db) = library("Lovless", "M.B.V.", &LOVELESS_DURATIONS);
        let root = root_of(dir.path());
        let transport = musicbrainz();

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &transport,
            &log_to(dir.path()),
            dir.path(),
            &mut live(),
            &unwatched(&held(both(&root))),
        )
        .unwrap();

        assert_eq!(summary.visited, 1);
        assert_eq!(summary.resolved, 1);
        assert_eq!(searches(&transport), 1);
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

    /// A pass cut short - a quit, a switch, an outage - leaves the library as
    /// its own cursor. The second sweep does what the first did not and does
    /// not redo what it did.
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

    /// A release whose rows went away between the survey and the mover is a
    /// release nothing was done to. Counting it would put the readout ahead of
    /// the library: the number says releases were filed, and none were.
    #[test]
    fn a_release_that_left_the_library_mid_sweep_is_not_placed() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        let root = root_of(dir.path());

        // Asked once per release and immediately before the move, which is the
        // seam a removal in that window lands in.
        let removed = Cell::new(0);
        let open = || {
            removed.set(removed.get() + 1);
            db.conn()
                .unwrap()
                .execute("DELETE FROM tracks", [])
                .unwrap();
            HashSet::new()
        };

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &musicbrainz(),
            &log_to(dir.path()),
            dir.path(),
            &mut live(),
            &Signals {
                steps: &held(filing(&root)),
                changed: &|| {},
                progress: &|_| {},
                open: &open,
            },
        )
        .unwrap();

        assert_eq!(removed.get(), 1, "the release did reach the mover");
        assert_eq!(summary.placed, 0);
    }

    /// The playing release is kept rather than dropped: a user who leaves one
    /// album on must not find it the only one left behind.
    #[test]
    fn the_playing_release_is_tried_again() {
        let (dir, db) = two_releases();
        let root = root_of(dir.path());
        let steps = filing(&root);

        // One track of one release, and two releases in the batch, so the
        // third ask is the drain's.
        let open = held_until(&db, 1, 2);

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
        assert_eq!(summary.placed, 2, "and moved by the drain");
        assert_eq!(left(&db, &steps), 0);
    }

    /// The one a tail could not do. A sweep now runs the library to
    /// exhaustion, so a release the tail is holding waits the ninety hours out
    /// - and the counters cannot tell the two apart, only the order can.
    #[test]
    fn a_release_left_playing_is_retried_before_the_next_batch() {
        let (dir, db) = three_releases();
        let root = root_of(dir.path());
        let steps = filing(&root);

        // The first release's first track, let go after one ask: the batch
        // defers it, and the drain at the end of that same batch finds it
        // free.
        let open = held_until(&db, 1, 1);

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &musicbrainz(),
            &log_to(dir.path()),
            dir.path(),
            &mut paged(),
            &Signals {
                steps: &held(steps.clone()),
                changed: &|| {},
                progress: &|_| {},
                open: &open,
            },
        )
        .unwrap();

        assert_eq!(summary.deferred, 1);
        assert_eq!(summary.placed, 3);
        let lines = lines_of(dir.path(), "library.place");
        assert!(
            lines[1].contains("album=Isn't Anything") && lines[1].contains("status=moved"),
            "the second line is a tail's second release, not the drain: {}",
            lines[1]
        );
        assert_eq!(left(&db, &steps), 0);
    }

    /// An album left on for the length of the sweep is retried at every drain
    /// and never dropped. The open set is what bounds that list - the playing
    /// track and the prepared next - so a drop rule would buy nothing and
    /// strand the one release the deferral exists for.
    #[test]
    fn a_release_played_all_sweep_is_retried_at_every_drain() {
        let (dir, db) = three_releases();
        let root = root_of(dir.path());
        let steps = filing(&root);

        let playing = leading_tracks(&db, 1);
        let asks = Cell::new(0);
        let open = || {
            asks.set(asks.get() + 1);
            playing.clone()
        };

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &musicbrainz(),
            &log_to(dir.path()),
            dir.path(),
            &mut paged(),
            &Signals {
                steps: &held(steps.clone()),
                changed: &|| {},
                progress: &|_| {},
                open: &open,
            },
        )
        .unwrap();

        assert_eq!(summary.placed, 2, "the two that were not playing");
        assert_eq!(asks.get(), 6, "three batches, each with a drain after it");
        assert_eq!(
            summary.deferred, 1,
            "one release, however many drains it went through"
        );
        assert_eq!(
            lines_of(dir.path(), "status=playing").len(),
            1,
            "and one line, not one per batch for ninety hours"
        );
        assert_eq!(left(&db, &steps), 1, "and the next sweep has it");
    }

    /// The other half of the list. A sweep that no longer parks would hand a
    /// tail two thousand declined releases and start it after the last of
    /// them; the retry comes at the end of the batch that declined instead.
    #[test]
    fn a_declined_release_is_asked_again_at_the_end_of_its_batch() {
        let (dir, db) = three_releases();

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &declining(),
            &log_to(dir.path()),
            dir.path(),
            &mut paged(),
            &unwatched(&held(looking_up())),
        )
        .unwrap();

        assert_eq!(summary.failed, 6, "each release asked twice");
        let lines = lines_of(dir.path(), "lookup.release");
        assert!(
            lines[1].contains("album=Isn't Anything"),
            "the second line is a tail's second release, not the drain: {}",
            lines[1]
        );
    }

    /// And asked twice and no more. The list has to shed what it retried, or a
    /// service that goes on declining fills it with a quarter of every batch
    /// and the bound is gone again.
    #[test]
    fn a_release_that_declines_twice_is_left_to_the_next_sweep() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        let transport = declining();

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

        assert_eq!(summary.failed, 2, "the batch's attempt and the drain's");
        assert_eq!(
            transport.call_count(),
            2 * 3,
            "two visits of three attempts, and no third"
        );
        assert_eq!(left(&db, &looking_up()), 1, "the next sweep has it back");
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

    /// The one that cost 34 of 38 sweeps in an evening: one release exhausting
    /// its three attempts parked the lookup step, and the sweep then ran out
    /// of anything to do within seconds.
    #[test]
    fn a_release_that_exhausts_its_attempts_does_not_end_the_sweep() {
        let (dir, db) = two_releases();

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &flaky(3),
            &log_to(dir.path()),
            dir.path(),
            &mut live(),
            &unwatched(&held(looking_up())),
        )
        .unwrap();

        assert_eq!(summary.failed, 1, "the three attempts of the first release");
        assert_eq!(
            summary.resolved, 2,
            "the release after it, which a parked step would never have reached"
        );
    }

    /// A 503 says nothing about the release, so it goes to the list the mover
    /// already keeps rather than being dropped for the sweep.
    #[test]
    fn a_release_a_503_deferred_is_resolved_by_the_drain() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &flaky(3),
            &log_to(dir.path()),
            dir.path(),
            &mut live(),
            &unwatched(&held(looking_up())),
        )
        .unwrap();

        assert_eq!(summary.failed, 1, "its only visit in the batch failed");
        assert_eq!(summary.resolved, 1, "so the drain is what resolved it");
        assert_eq!(left(&db, &looking_up()), 0);
    }

    /// The backstop is a run rather than the first failure: a network that is
    /// down must not put all 8,044 releases through three attempts each.
    #[test]
    fn a_run_of_failures_parks_the_lookup_for_the_rest_of_the_sweep() {
        let (dir, db) = releases(OUTAGE + 1);
        let transport = unanswered();

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

        assert_eq!(summary.failed, OUTAGE);
        assert_eq!(
            transport.call_count(),
            OUTAGE * 3,
            "three attempts each, and the release after the run was never asked"
        );
    }

    /// The threshold is the run, not the rate: a library of ordinary failures
    /// has to keep being asked right up to it.
    #[test]
    fn a_run_one_short_of_the_threshold_leaves_the_step_on() {
        let (dir, db) = releases(OUTAGE - 1);
        let transport = unanswered();

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

        assert_eq!(
            summary.run,
            OUTAGE - 1,
            "the last of them was asked, so the step was on for it"
        );
        assert_eq!(
            summary.failed,
            (OUTAGE - 1) * 2,
            "and the drain asked every one of them a second time"
        );
        assert_eq!(transport.call_count(), (OUTAGE - 1) * 2 * 3);
    }

    /// The one the sweep-scoped count could not do: a network that is down
    /// must not be worth another [`OUTAGE`] lookups every fifteen seconds.
    #[test]
    fn the_run_outlives_the_sweep_it_ended() {
        let (dir, db) = releases(OUTAGE - 1);
        let transport = unanswered();
        let mut plan = live();
        let steps = held(looking_up());
        let signals = unwatched(&steps);

        let first = sweep(
            &db,
            &ScanLock::default(),
            &transport,
            &log_to(dir.path()),
            dir.path(),
            &mut plan,
            &signals,
        )
        .unwrap();
        assert_eq!(first.run, OUTAGE - 1, "one short, so nothing parked");
        assert_eq!(plan.failures, OUTAGE - 1, "and the run is what it carries");

        let asked = transport.call_count();
        let second = sweep(
            &db,
            &ScanLock::default(),
            &transport,
            &log_to(dir.path()),
            dir.path(),
            &mut plan,
            &signals,
        )
        .unwrap();

        assert_eq!(second.failed, 1, "the probe, and then the step is parked");
        assert_eq!(second.run, OUTAGE);
        assert_eq!(
            transport.call_count() - asked,
            3,
            "one lookup's three attempts, not another run of them"
        );
    }

    /// The carry is evidence about the network, so the network is what drops
    /// it - otherwise a burst at the end of one sweep parks the next one.
    #[test]
    fn a_verdict_clears_a_carried_run() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        let mut plan = Plan {
            failures: OUTAGE - 1,
            ..live()
        };

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &musicbrainz(),
            &log_to(dir.path()),
            dir.path(),
            &mut plan,
            &unwatched(&held(looking_up())),
        )
        .unwrap();

        assert_eq!(summary.resolved, 1);
        assert_eq!(plan.failures, 0);
        assert_eq!(summary.run, 0, "and the line says nothing happened");
    }

    /// The one that parked six sweeps in six hours on a service that was
    /// answering every time: a 503 is MusicBrainz replying, so no number of
    /// them in a row is an outage and the step has to stay on through all of
    /// them.
    #[test]
    fn a_run_of_declines_never_parks_the_step() {
        let (dir, db) = releases(OUTAGE + 3);
        let transport = declining();
        let mut plan = live();

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &transport,
            &log_to(dir.path()),
            dir.path(),
            &mut plan,
            &unwatched(&held(looking_up())),
        )
        .unwrap();

        assert_eq!(summary.run, 0, "no run of declines is a run at all");
        assert_eq!(plan.failures, 0, "and nothing is carried to the next sweep");
        assert_eq!(
            transport.call_count(),
            (OUTAGE + 3) * 2 * 3,
            "every release asked, and asked again by the drain"
        );
    }

    /// A pass paying a third of itself to a busy service still has to say so -
    /// that is `failed`, and it is the counter the run cannot double as.
    #[test]
    fn a_decline_counts_as_a_failure_and_not_as_a_run() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        let mut plan = live();

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &declining(),
            &log_to(dir.path()),
            dir.path(),
            &mut plan,
            &unwatched(&held(looking_up())),
        )
        .unwrap();

        assert_eq!(summary.failed, 2, "the batch's attempt and the drain's");
        assert_eq!(summary.run, 0);
        assert_eq!(plan.failures, 0);
    }

    /// Neither up nor down. A 503 is evidence the path is up, but `Server` is
    /// wider than MusicBrainz and a flapping network would alternate, so
    /// clearing on one would make an outage undetectable.
    #[test]
    fn a_decline_does_not_clear_a_carried_run() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        let mut plan = Plan {
            failures: OUTAGE - 1,
            ..live()
        };

        sweep(
            &db,
            &ScanLock::default(),
            &declining(),
            &log_to(dir.path()),
            dir.path(),
            &mut plan,
            &unwatched(&held(looking_up())),
        )
        .unwrap();

        assert_eq!(plan.failures, OUTAGE - 1, "left exactly where it stood");
    }

    /// Only a 503 is the service declining. A gateway stuck on 502 is the
    /// outage the backstop exists for, and it arrives as the same variant.
    #[test]
    fn a_server_error_that_is_not_a_decline_parks_the_step() {
        let (dir, db) = releases(OUTAGE + 1);
        let transport = answering_with(502);

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

        assert_eq!(summary.run, OUTAGE);
        assert_eq!(
            transport.call_count(),
            OUTAGE * 3,
            "the release after the run was never asked"
        );
    }

    /// A lookup that never reached the service must not file a release under
    /// the tags it was about to replace, or the next sweep would move it a
    /// second time.
    #[test]
    fn the_drain_does_not_place_a_release_whose_lookup_never_reached_it() {
        let (dir, db) = releases(OUTAGE);
        let root = root_of(dir.path());
        let steps = both(&root);
        let before = paths(&db);

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &unanswered(),
            &log_to(dir.path()),
            dir.path(),
            &mut live(),
            &unwatched(&held(steps)),
        )
        .unwrap();

        assert_eq!(summary.failed, OUTAGE, "the run that parked the step");
        assert_eq!(summary.placed, 0);
        assert_eq!(paths(&db), before, "and nothing moved");
    }

    /// `pass.sweep` is written when the sweep ends, and a sweep that runs the
    /// library to exhaustion is ninety hours long against a process restarted
    /// about daily.
    #[test]
    fn a_sweep_writes_its_counters_down_before_it_ends() {
        let (dir, db) = releases(5);
        let mut plan = Plan {
            progress_every: 2,
            ..live()
        };

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &musicbrainz(),
            &log_to(dir.path()),
            dir.path(),
            &mut plan,
            &unwatched(&held(looking_up())),
        )
        .unwrap();

        assert_eq!(summary.visited, 5);
        let lines = lines_of(dir.path(), "pass.progress");
        assert_eq!(lines.len(), 2, "at the second release and at the fourth");
        assert!(lines[0].contains("visited=2"), "{}", lines[0]);
        assert!(lines[1].contains("visited=4"), "{}", lines[1]);
    }

    /// Written where it was reached rather than backfilled from an end that
    /// may never come - and written at all across a stretch that visits
    /// nothing, which is what an outage is.
    #[test]
    fn a_progress_line_carries_the_run_the_sweep_had_reached() {
        let (dir, db) = releases(OUTAGE + 1);
        let mut plan = Plan {
            progress_every: 2,
            ..live()
        };

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &unanswered(),
            &log_to(dir.path()),
            dir.path(),
            &mut plan,
            &unwatched(&held(looking_up())),
        )
        .unwrap();

        assert_eq!(summary.run, OUTAGE, "the sweep ended parked");
        let lines = lines_of(dir.path(), "pass.progress");
        let releases = OUTAGE + 1;
        assert_eq!(lines.len(), releases / 2, "one every two releases");
        assert!(
            lines[0].contains("run=2"),
            "the run then, not the {} it ended on: {}",
            summary.run,
            lines[0]
        );
        assert!(
            lines[0].contains("visited=0"),
            "a failed lookup is not visited, and the line came anyway: {}",
            lines[0]
        );
    }

    /// The drain carries the mover's deferrals as well as the lookup's, and the
    /// mover's have already been looked up: a second lookup would search on
    /// tags nothing carries any more and queue a release that was resolved.
    #[test]
    fn a_release_the_mover_deferred_is_not_looked_up_again_by_the_drain() {
        let (dir, db) = library("Loveless", "My Bloody Valentine", &LOVELESS_DURATIONS);
        let root = root_of(dir.path());
        let transport = musicbrainz();

        // The whole release, and one release in the batch, so the second ask
        // is the drain's, which is what puts the release on the list with its
        // lookup already done.
        let open = held_until(&db, LOVELESS_DURATIONS.len(), 1);

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &transport,
            &log_to(dir.path()),
            dir.path(),
            &mut live(),
            &Signals {
                steps: &held(both(&root)),
                changed: &|| {},
                progress: &|_| {},
                open: &open,
            },
        )
        .unwrap();

        assert_eq!(summary.deferred, 1, "it was left alone while it played");
        assert_eq!(summary.resolved, 1);
        assert_eq!(summary.queued, 0, "the second lookup would have queued it");
        assert_eq!(searches(&transport), 1);
    }

    /// And it is filed under the name the lookup left on it. The deferral
    /// carries the refreshed release rather than the tags the release arrived
    /// with: a move under those finds no file, and the release sits where it
    /// is until the next sweep.
    #[test]
    fn the_drain_moves_a_deferred_release_under_the_name_it_has_now() {
        let (dir, db) = library("Lovless", "M.B.V.", &LOVELESS_DURATIONS);
        let root = root_of(dir.path());
        let steps = both(&root);
        let transport = musicbrainz();

        // As above: the second ask is the drain's.
        let open = held_until(&db, LOVELESS_DURATIONS.len(), 1);

        let summary = sweep(
            &db,
            &ScanLock::default(),
            &transport,
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

        assert_eq!(summary.placed, 1);
        assert!(
            paths(&db)
                .iter()
                .all(|path| Path::new(path).starts_with(&root)),
            "a file was left outside the library folder"
        );
        assert_eq!(left(&db, &filing(&root)), 0);
        assert_eq!(searches(&transport), 1, "and looked up once");
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
