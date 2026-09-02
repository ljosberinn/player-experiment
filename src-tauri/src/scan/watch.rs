//! The unattended pass: what makes a watch folder actually watched.
//!
//! A poll on a timer, reusing [`super::scan_roots`]. The scan is already
//! incremental by (mtime, size), so a pass that finds nothing costs a
//! directory walk and one read of the `tracks` table, and no tag reads at all.
//!
//! Not `notify`/ReadDirectoryChangesW. A live event stream drops events on
//! network and removable volumes and sees nothing that happened while the app
//! was closed, so it would still need the full walk at startup - a second code
//! path beside this one rather than a replacement for it.
//!
//! Not a webview `setInterval` either: WebView2 throttles timers in a hidden
//! window, which is exactly when a background pass is wanted.

use std::path::PathBuf;
use std::time::Duration;

use rusqlite::Connection;

use crate::db::{settings, Db};
use crate::error::AppResult;
use crate::log::Log;
use crate::model::{ScanProgress, ScanSummary};

use super::ScanLock;

/// How often the thread wakes to ask whether a pass is due.
///
/// The intervals on offer are minutes apart, so this decides two things only:
/// how soon a changed setting takes effect, and how late a pass can be.
const TICK: Duration = Duration::from_secs(15);

/// How long after launch the first pass runs.
///
/// There is one at all because it is what makes the poll a replacement rather
/// than an addition: nothing else notices what changed while the app was
/// closed, and there is no scan at startup. Late enough that it is not
/// competing with the window's first queries.
const FIRST_PASS: Duration = Duration::from_secs(15);

/// One pass over the watch folders that are actually there.
///
/// A root that is gone contributes nothing - neither its files nor their
/// absence. `walk` on a missing root yields nothing and [`super::plan`] would
/// then mark every track under it missing, which is the right answer when the
/// user asked for a scan and ruinous on a timer: unplug an external drive and
/// tens of thousands of tracks quietly go missing while nobody is looking.
///
/// `on_progress` sees nothing while there is nothing to report, so a pass that
/// finds no work cannot flash "Scanning 0 of 0" over a window the user is
/// using.
pub fn pass(
    conn: &mut Connection,
    mut on_progress: impl FnMut(ScanProgress),
) -> AppResult<ScanSummary> {
    let (present, absent): (Vec<PathBuf>, Vec<PathBuf>) = super::watch_folders(conn)?
        .into_iter()
        .partition(|root| root.is_dir());

    super::scan_roots(conn, &present, &absent, |progress| {
        if progress.total > 0 {
            on_progress(progress);
        }
    })
}

/// Starts the `library-watch` thread.
///
/// Its own named thread, the same shape as `Player::watch_output`: it sleeps
/// in short units and reads the interval from `settings` each wake, so
/// changing it in Settings applies without a restart and needs no channel.
///
/// `on_change` runs only when a pass actually changed something. A success
/// nobody asked for is as quiet as a failure nobody asked for.
pub fn spawn(
    db: Db,
    lock: ScanLock,
    log: Log,
    mut on_progress: impl FnMut(ScanProgress) + Send + 'static,
    on_change: impl Fn() + Send + 'static,
) {
    let _ = std::thread::Builder::new()
        .name("library-watch".to_owned())
        .spawn(move || {
            let mut waited = Duration::ZERO;
            let mut first = true;

            loop {
                std::thread::sleep(TICK);
                waited += TICK;

                // Read every wake rather than captured once, which is the
                // whole reason for the short sleep: a new interval applies a
                // tick later instead of at the next restart.
                let minutes = match db.conn().and_then(|conn| settings::watch_interval(&conn)) {
                    Ok(minutes) => minutes,
                    // Unreadable settings mean the database is busy or gone.
                    // Either way the next wake can ask again.
                    Err(_) => continue,
                };
                // Off stops the pass, not the thread - so turning it back on
                // does not need a restart either.
                if minutes == 0 {
                    continue;
                }

                let due = if first {
                    FIRST_PASS
                } else {
                    Duration::from_secs(u64::from(minutes) * 60)
                };
                if waited < due {
                    continue;
                }
                waited = Duration::ZERO;
                first = false;

                // `try_acquire`, not `acquire`: whatever holds the lock is
                // already walking the library, and a pass queued behind it
                // would walk everything again to find the same nothing.
                let Some(_guard) = lock.try_acquire() else {
                    continue;
                };
                // A pass that changed nothing still says nothing to the
                // window; the log is where it says so, since "the timer is
                // running and finds nothing" and "the timer stopped" look the
                // same from outside.
                let op = log.op("scan.watch");
                let summary = db
                    .conn()
                    .and_then(|mut conn| pass(&mut conn, &mut on_progress));

                match &summary {
                    Ok(summary) => op.succeeded(super::summary_fields(summary)),
                    Err(error) => op.failed(error),
                }

                match summary {
                    Ok(summary) if summary.changed() => on_change(),
                    Ok(_) | Err(_) => {}
                }
            }
        });
}
