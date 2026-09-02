//! Every operation that touches the backend, written down.
//!
//! `crashes.log` covers the process dying and nothing else, and the progress
//! channels are gone the moment the window closes. So when a scan drops a
//! folder, a tag write half-lands or a scrobble never arrives, there is
//! nothing to read. This is that file.
//!
//! No `log` or `tracing` crate: what those buy is levels, targets and
//! filtering, none of which is wanted here - the set of operations is the
//! product decision, not a runtime knob. What is left is a `Mutex<File>` and a
//! line format, which is the same call `crash.rs` made.
//!
//! **One whole line per lock.** The `rayon` scan pool, the player thread and
//! the scrobbler thread all write, and half a line from one inside another's
//! is worse than no line at all.
//!
//! [`format`] and [`rotate`] are pure functions over a path so they are
//! testable without an app, like `crash::format`.

use std::fmt::Display;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::error::AppResult;

/// Where the log grows to before the current one is set aside.
///
/// Two files of this, and no third generation: a log that needs sweeping up is
/// a second feature, and the questions this answers are asked about the last
/// few hours rather than the last few weeks.
const MAX_BYTES: u64 = 5 * 1024 * 1024;

/// What the previous file is called once it stops being the current one.
const PREVIOUS: &str = "main_prev.log";

/// The log lives beside the database and the crash log: one folder holds
/// everything this app has put on the machine.
pub fn log_path(data_dir: &Path) -> PathBuf {
    data_dir.join("main.log")
}

/// Handle to the file, shared by every thread that writes to it.
///
/// Cloned rather than reached through `AppHandle` at each site: the player and
/// scrobbler threads outlive no `State` lookup, and a clone is an `Arc` bump.
#[derive(Clone)]
pub struct Log {
    inner: Arc<Inner>,
}

struct Inner {
    path: PathBuf,
    /// `None` until the first line, and again for the moment between closing
    /// the full file and opening its replacement. Windows will not rename a
    /// file this process still holds open, so rotation has to be able to say
    /// "no file right now" rather than swapping one handle for another.
    file: Mutex<Option<std::fs::File>>,
}

impl Log {
    pub fn to(path: PathBuf) -> Self {
        Self {
            inner: Arc::new(Inner {
                path,
                file: Mutex::new(None),
            }),
        }
    }

    pub fn path(&self) -> &Path {
        &self.inner.path
    }

    /// Starts an operation. Nothing is written until it finishes.
    pub fn op(&self, name: &'static str) -> Op {
        Op {
            log: self.clone(),
            name,
            started: Instant::now(),
            fields: Fields::new(),
            quiet: false,
        }
    }

    /// Writes down something that already happened somewhere else.
    ///
    /// No `ms`: an event arriving from the player thread is reported after the
    /// fact, and a duration measured from the moment it was reported would say
    /// zero for work that took a second.
    pub fn note(&self, name: &str, fields: Fields) {
        self.line(&format(crate::now_seconds(), "ok", name, &fields));
    }

    /// Appends one line, rotating first if it would not fit.
    ///
    /// Failures are swallowed: nothing in the app is worth failing because it
    /// could not be written down, and there is nowhere left to report a log
    /// that cannot be logged to.
    pub fn line(&self, line: &str) {
        // Poison-tolerant, like `ScanLock`: a panic mid-write must not leave
        // the rest of the session unable to record anything, least of all the
        // session in which something has already gone wrong.
        let mut slot = self
            .inner
            .file
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = append(&self.inner.path, &mut slot, line);
    }
}

/// One operation, from the moment it starts to the line it leaves behind.
///
/// Created before the work so `ms=` measures the work rather than the part of
/// it after somebody remembered to start a timer.
pub struct Op {
    log: Log,
    name: &'static str,
    started: Instant,
    fields: Fields,
    quiet: bool,
}

impl Op {
    /// Adds a `key=value` known before the work runs.
    pub fn add(mut self, key: &'static str, value: impl Display) -> Self {
        self.fields = self.fields.add(key, value);
        self
    }

    /// Says nothing on success. What a read gets: a `query_tracks` that fails
    /// leaves a trace, and the thousands that do not are not an operation
    /// anybody is going to look for.
    pub fn quiet(mut self) -> Self {
        self.quiet = true;
        self
    }

    /// Runs `work` and writes its outcome down.
    pub fn run<T>(self, work: impl FnOnce() -> AppResult<T>) -> AppResult<T> {
        self.run_with(work, |_| Fields::new())
    }

    /// [`Op::run`], with fields that only the result knows - the counts a
    /// summary carries, which are the whole reason for the line in most cases.
    pub fn run_with<T>(
        self,
        work: impl FnOnce() -> AppResult<T>,
        fields: impl FnOnce(&T) -> Fields,
    ) -> AppResult<T> {
        let outcome = work();
        match &outcome {
            Ok(value) => self.succeeded(fields(value)),
            Err(error) => self.failed(error),
        }
        outcome
    }

    /// Writes the success line, unless this operation is [`Op::quiet`].
    pub fn succeeded(self, extra: Fields) {
        if self.quiet {
            return;
        }
        let fields = self
            .fields
            .merge(extra)
            .add("ms", self.started.elapsed().as_millis());
        self.log
            .line(&format(crate::now_seconds(), "ok", self.name, &fields));
    }

    /// Writes the failure line. Never quiet: a failure is the reason the file
    /// exists.
    ///
    /// No `ms`. The number that matters about a failure is not how long it
    /// took, and the display string is what the user was shown - so a
    /// screenshot and the log line say the same thing.
    pub fn failed(self, error: &dyn Display) {
        let fields = self.fields.add("error", error);
        self.log
            .line(&format(crate::now_seconds(), "err", self.name, &fields));
    }
}

/// The `key=value` tail of a line.
///
/// Values are written as they are, quotes and all: a path with a space in it
/// is still readable, and quoting would only move the problem to the paths
/// with quotes in them. Nothing parses this file.
#[derive(Default)]
pub struct Fields(String);

impl Fields {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(mut self, key: &'static str, value: impl Display) -> Self {
        if !self.0.is_empty() {
            self.0.push(' ');
        }
        self.0.push_str(key);
        self.0.push('=');
        // A value spanning two lines would break the one-line-per-operation
        // rule that makes the file readable at all. An `AppError` carrying an
        // OS message is the realistic source of one.
        self.0.extend(value.to_string().chars().map(|c| match c {
            '\n' | '\r' => ' ',
            other => other,
        }));
        self
    }

    fn merge(mut self, other: Fields) -> Self {
        if other.0.is_empty() {
            return self;
        }
        if !self.0.is_empty() {
            self.0.push(' ');
        }
        self.0.push_str(&other.0);
        self
    }
}

impl Display for Fields {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// One line: when, whether it worked, what it was, and the rest.
///
/// The two columns are padded so a run of lines reads down rather than across.
/// Split from the writer, and taking its clock as an argument, so the format
/// is testable without a file or a wall clock.
pub fn format(when: i64, outcome: &str, op: &str, fields: &Fields) -> String {
    format!("{} {outcome:<3} {op:<15} {fields}\n", timestamp(when))
}

/// Seconds since the epoch as `2026-09-02T14:03:11Z`.
///
/// Assembled from the components rather than through a well-known format, so
/// the shape here is the shape in the file - `time`'s RFC 3339 also carries
/// subseconds and spells UTC as an offset.
fn timestamp(when: i64) -> String {
    let at =
        time::OffsetDateTime::from_unix_timestamp(when).unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        at.year(),
        u8::from(at.month()),
        at.day(),
        at.hour(),
        at.minute(),
        at.second()
    )
}

/// Sets the current file aside, overwriting whatever the previous one was.
///
/// A rename rather than a copy-and-truncate: the file being replaced may be
/// megabytes, and a reader with it open keeps reading the bytes it had.
pub fn rotate(path: &Path) -> std::io::Result<()> {
    std::fs::rename(path, path.with_file_name(PREVIOUS))
}

/// Appends `line`, rotating first if it would take the file past [`MAX_BYTES`].
///
/// Checked before the write rather than after, so the bound holds for the file
/// as it is read rather than as it was one line ago.
fn append(path: &Path, slot: &mut Option<std::fs::File>, line: &str) -> std::io::Result<()> {
    if slot.is_none() {
        *slot = Some(open(path)?);
    }
    let file = slot.as_mut().expect("just opened");

    if file.metadata()?.len() + line.len() as u64 > MAX_BYTES {
        // Closed before the rename, not after: Windows refuses to move a file
        // this process is still holding, and the failure is silent here.
        *slot = None;
        rotate(path)?;
        *slot = Some(open(path)?);
    }

    slot.as_mut().expect("open").write_all(line.as_bytes())
}

/// Opens the file for appending, creating it and its directory if needed.
///
/// Unbuffered: a line is written when it is written, because the run that
/// wants reading is often the one that ended in a way that flushes nothing.
fn open(path: &Path) -> std::io::Result<std::fs::File> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> (tempfile::TempDir, Log) {
        let dir = tempfile::tempdir().expect("tempdir");
        let log = Log::to(log_path(dir.path()));
        (dir, log)
    }

    fn contents(log: &Log) -> String {
        std::fs::read_to_string(log.path()).unwrap_or_default()
    }

    #[test]
    fn a_line_leads_with_when_it_happened_and_whether_it_worked() {
        let line = format(
            1_700_000_000,
            "ok",
            "scan",
            &Fields::new().add("added", 412).add("ms", 8140),
        );

        assert_eq!(
            line,
            "2023-11-14T22:13:20Z ok  scan            added=412 ms=8140\n"
        );
    }

    #[test]
    fn the_two_columns_line_up_across_operations() {
        let short = format(0, "ok", "scan", &Fields::new());
        let long = format(0, "err", "playlist.delete", &Fields::new());

        let column = |line: &str| line.find("scan").or_else(|| line.find("playlist"));
        assert_eq!(column(&short), column(&long));
    }

    #[test]
    fn a_failure_carries_the_string_the_user_was_shown() {
        let (_dir, log) = temp();

        log.op("playlist.delete")
            .add("id", 12)
            .failed(&crate::error::AppError::NotFound(
                "playlist not found".into(),
            ));

        let written = contents(&log);
        assert!(
            written.contains("err playlist.delete id=12 error=playlist not found"),
            "unexpected line: {written}"
        );
        assert!(
            !written.contains("ms="),
            "how long a failure took is not what anybody is reading it for"
        );
    }

    #[test]
    fn a_read_that_works_writes_nothing_and_one_that_fails_writes_a_line() {
        let (_dir, log) = temp();

        let _ = log.op("tracks.query").quiet().run(|| Ok(7));
        assert_eq!(contents(&log), "", "a successful read left a line behind");

        let failed: AppResult<u32> = log.op("tracks.query").quiet().run(|| {
            Err(crate::error::AppError::Internal(
                "database is locked".into(),
            ))
        });

        assert!(failed.is_err());
        assert!(contents(&log).contains("err tracks.query"));
    }

    #[test]
    fn the_result_supplies_the_fields_only_it_knows() {
        let (_dir, log) = temp();

        let _ = log
            .op("scan")
            .run_with(|| Ok(412_u32), |added| Fields::new().add("added", added));

        assert!(contents(&log).contains("ok  scan            added=412 ms="));
    }

    #[test]
    fn a_full_file_is_set_aside_rather_than_grown() {
        let (dir, log) = temp();
        // One line under the bound, so the next one cannot fit.
        std::fs::write(log.path(), "x".repeat(MAX_BYTES as usize - 4)).unwrap();

        log.line("the line that did not fit\n");

        assert_eq!(
            contents(&log),
            "the line that did not fit\n",
            "the new file should hold only what came after the rotation"
        );
        let previous = std::fs::read_to_string(dir.path().join(PREVIOUS)).unwrap();
        assert_eq!(previous.len(), MAX_BYTES as usize - 4);
    }

    #[test]
    fn rotating_twice_keeps_two_files_rather_than_three() {
        let (dir, log) = temp();

        for round in 0..3 {
            std::fs::write(log.path(), "x".repeat(MAX_BYTES as usize - 4)).unwrap();
            // The handle now points at a file this test replaced underneath it,
            // which is the same position a rotation leaves it in.
            log.line(&format!("round {round}\n"));
        }

        let files: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok().map(|entry| entry.file_name()))
            .collect();
        assert_eq!(files.len(), 2, "unexpected files: {files:?}");
    }

    #[test]
    fn every_thread_writing_at_once_leaves_whole_lines() {
        // The reason for the lock: a half-line from the scan pool inside one
        // from the scrobbler is worse than no line at all.
        let (_dir, log) = temp();

        std::thread::scope(|scope| {
            for thread in 0..8 {
                let log = log.clone();
                scope.spawn(move || {
                    for line in 0..50 {
                        log.line(&format!("thread {thread} line {line}\n"));
                    }
                });
            }
        });

        let written = contents(&log);
        let lines: Vec<_> = written.lines().collect();
        assert_eq!(lines.len(), 400);
        assert!(
            lines
                .iter()
                .all(|line| line.starts_with("thread ") && line.contains(" line ")),
            "a line was cut in two"
        );
    }

    #[test]
    fn a_message_spanning_two_lines_is_still_one_line_in_the_file() {
        let (_dir, log) = temp();

        log.op("tags.write")
            .failed(&"the file is locked\nby another program");

        assert_eq!(contents(&log).lines().count(), 1);
    }
}
