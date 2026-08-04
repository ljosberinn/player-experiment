//! What happens when the app panics.
//!
//! Phase 11 would have sent panics to Sentry and was cut: a network stack in
//! an application whose premise is that it does not use the network. The
//! failure class it covered is still real and still invisible. A panic on the
//! player thread, in the `rayon` scan pool, or inside a decoder on a malformed
//! file takes the process with it, and **no JavaScript handler ever runs** -
//! the webview is gone before it could be told. What the user sees is the
//! window disappearing.
//!
//! So the panic is written down instead, in a file beside the library, and the
//! next launch says so. No network, no DSN, no consent toggle to design, and
//! nothing to scrub: the report never leaves the machine it was written on,
//! which is the whole reason phase 11's scrubbing section does not exist here.

use std::io::Write;
use std::path::{Path, PathBuf};

/// Reports kept in the log. Older ones are dropped as new ones arrive.
///
/// Five rather than one because the interesting crash is often not the last:
/// a panic on the scan pool that only happens on one folder will be followed
/// by ordinary launches, and a log holding one report would have lost it by
/// the time anyone looked.
const KEEP: usize = 5;

/// Separates reports in the file. Chosen to be something no backtrace, panic
/// message or path can contain, so splitting on it cannot cut a report in two.
const SEPARATOR: &str = "\n===== crash =====\n";

/// The log lives beside the database, not in a separate log directory: one
/// folder holds everything this app has put on the machine.
pub fn log_path(data_dir: &Path) -> PathBuf {
    data_dir.join("crashes.log")
}

/// One panic, as it is written down and as it is read back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    /// Seconds since the epoch. Kept as a number rather than a formatted
    /// string so the frontend can render it in the user's own locale, and so
    /// "have I already seen this one" is a comparison rather than a match.
    pub when: i64,
    pub text: String,
}

impl Report {
    /// The panic message alone - the one line worth putting in front of a
    /// user. A report whose header is somehow missing it says so rather than
    /// showing the first line of a backtrace as though it were the cause.
    pub fn summary(&self) -> &str {
        self.text
            .lines()
            .find_map(|line| line.strip_prefix("panic: "))
            .unwrap_or("The app closed unexpectedly.")
    }
}

/// Formats a report.
///
/// Split from the hook because a `PanicHookInfo` cannot be constructed outside
/// a real panic, so a hook that formatted inline could not be tested at all.
/// Everything the hook knows is a parameter here.
pub fn format(
    when: i64,
    version: &str,
    thread: &str,
    message: &str,
    location: Option<&str>,
    backtrace: &str,
) -> String {
    let mut report = String::new();
    report.push_str(&format!("when: {when}\n"));
    report.push_str(&format!("version: {version}\n"));
    report.push_str(&format!("thread: {thread}\n"));
    report.push_str(&format!("location: {}\n", location.unwrap_or("unknown")));
    // Last of the header and first thing anyone reads, so it is not buried
    // between the version and the backtrace.
    report.push_str(&format!("panic: {message}\n"));

    let backtrace = backtrace.trim();
    if !backtrace.is_empty() {
        report.push_str("backtrace:\n");
        report.push_str(backtrace);
        report.push('\n');
    }
    report
}

/// Appends a report, keeping only the most recent [`KEEP`].
///
/// Read-modify-write rather than append-and-truncate-later, because the file
/// is written at most a handful of times in the life of an install and being
/// obviously correct is worth more here than being fast. It is also the only
/// way to bound the file: an append-only log of backtraces on a machine with a
/// reproducible panic grows without limit.
pub fn append(path: &Path, report: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut kept = read_reports(path);
    kept.push(report.trim_end().to_owned());
    let kept = kept.split_off(kept.len().saturating_sub(KEEP));

    // Written whole rather than appended: a partial write leaves the file
    // unreadable, and there is nothing here worth preserving from a version of
    // it that was already about to be rewritten.
    let mut file = std::fs::File::create(path)?;
    file.write_all(kept.join(SEPARATOR).as_bytes())?;
    file.write_all(b"\n")?;
    file.flush()
}

/// The reports in the file, oldest first. A missing or unreadable file is no
/// reports, not an error: nothing here is worth failing a launch over.
fn read_reports(path: &Path) -> Vec<String> {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    contents
        .split(SEPARATOR)
        .map(str::trim)
        .filter(|report| !report.is_empty())
        .map(str::to_owned)
        .collect()
}

/// The most recent report, if there is one.
///
/// A report whose header cannot be parsed still comes back, with `when: 0`:
/// the text is what a person needs, and refusing to show a crash because its
/// timestamp line was mangled would be losing the only copy of it.
pub fn latest(path: &Path) -> Option<Report> {
    let text = read_reports(path).pop()?;
    let when = text
        .lines()
        .find_map(|line| line.strip_prefix("when: "))
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(0);
    Some(Report { when, text })
}

/// Installs the panic hook.
///
/// Chains the previous hook rather than replacing it, so a debug build still
/// prints to stderr and `cargo test` output is unchanged. Called once, at
/// startup, before anything that could panic has been spawned.
pub fn install(path: PathBuf, version: String) {
    let previous = std::panic::take_hook();

    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let thread = thread.name().unwrap_or("unnamed").to_owned();

        let report = format(
            crate::now_seconds(),
            &version,
            &thread,
            &message_of(info),
            info.location().map(|at| at.to_string()).as_deref(),
            &std::backtrace::Backtrace::force_capture().to_string(),
        );

        // Ignored deliberately: the process is already going down, and there
        // is nowhere left to report a failure to write the report *to*.
        let _ = append(&path, &report);

        previous(info);
    }));
}

/// The panic message, whatever the payload turned out to be.
///
/// `panic!("{x}")` gives a `String`, `panic!("literal")` gives a `&str`, and
/// anything reaching `panic_any` gives neither - which is not nothing, so it
/// is reported as what it is rather than dropped.
fn message_of(info: &std::panic::PanicHookInfo<'_>) -> String {
    let payload = info.payload();
    if let Some(text) = payload.downcast_ref::<&str>() {
        (*text).to_owned()
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text.clone()
    } else {
        "a panic payload that is neither a string nor a &str".to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = log_path(dir.path());
        (dir, path)
    }

    #[test]
    fn a_report_leads_with_what_went_wrong() {
        let report = format(
            1_700_000_000,
            "0.4.0",
            "player",
            "index out of bounds",
            Some("src/audio/engine.rs:42:9"),
            "   0: player::audio::engine::tick",
        );

        assert!(report.contains("panic: index out of bounds"));
        assert!(report.contains("location: src/audio/engine.rs:42:9"));
        assert!(report.contains("thread: player"));
        assert!(report.contains("version: 0.4.0"));
        assert!(report.contains("when: 1700000000"));
        assert!(report.contains("player::audio::engine::tick"));
    }

    #[test]
    fn a_panic_with_no_location_still_reports() {
        // `location` is `None` for a panic raised from a foreign frame. A
        // report that refused to say anything in that case would be worse than
        // one that says it does not know where.
        let report = format(1, "0.4.0", "unnamed", "boom", None, "");

        assert!(report.contains("location: unknown"));
        assert!(
            !report.contains("backtrace:"),
            "an empty backtrace should not get a heading of its own"
        );
    }

    #[test]
    fn the_log_keeps_the_most_recent_reports_and_drops_the_rest() {
        let (_dir, path) = temp();

        for index in 0..KEEP + 3 {
            append(
                &path,
                &format(index as i64, "0.4.0", "main", "boom", None, ""),
            )
            .unwrap();
        }

        let contents = std::fs::read_to_string(&path).unwrap();
        let reports = read_reports(&path);
        assert_eq!(reports.len(), KEEP, "the log grew past its bound");
        assert!(
            !contents.contains("when: 0\n"),
            "the oldest report is still there"
        );
        assert!(contents.contains(&format!("when: {}", KEEP + 2)));
    }

    #[test]
    fn the_latest_report_is_the_one_that_comes_back() {
        let (_dir, path) = temp();
        append(&path, &format(10, "0.4.0", "main", "first", None, "")).unwrap();
        append(&path, &format(20, "0.4.0", "player", "second", None, "")).unwrap();

        let latest = latest(&path).expect("a report");
        assert_eq!(latest.when, 20);
        assert!(latest.text.contains("panic: second"));
        assert!(
            !latest.text.contains("first"),
            "the split let one report bleed into the next"
        );
    }

    #[test]
    fn a_log_that_is_not_there_is_not_an_error() {
        let (_dir, path) = temp();
        assert_eq!(latest(&path), None);
    }

    #[test]
    fn a_report_containing_the_separators_own_words_still_splits_cleanly() {
        // A panic message is arbitrary text, including text that looks like the
        // file's own framing. It cannot contain the separator, which carries
        // newlines on both sides, but it can contain the words in it.
        let (_dir, path) = temp();
        append(
            &path,
            &format(1, "0.4.0", "main", "===== crash =====", None, ""),
        )
        .unwrap();
        append(&path, &format(2, "0.4.0", "main", "later", None, "")).unwrap();

        assert_eq!(read_reports(&path).len(), 2);
        assert!(latest(&path).expect("a report").text.contains("later"));
    }

    #[test]
    fn a_panic_on_a_spawned_thread_reaches_the_file() {
        // The case the whole module exists for: a panic off the main thread,
        // where nothing else would have noticed. The hook is process-wide, so
        // this is restored afterwards rather than left installed for whichever
        // test runs next on this thread.
        let (_dir, path) = temp();
        let previous = std::panic::take_hook();
        install(path.clone(), "0.4.0".to_owned());

        std::thread::Builder::new()
            .name("scan-worker".to_owned())
            .spawn(|| panic!("a malformed frame"))
            .unwrap()
            .join()
            .expect_err("the thread was supposed to panic");

        std::panic::set_hook(previous);

        // Searched rather than taking the latest: the hook is process-wide and
        // the harness runs tests in parallel, so another test panicking on
        // purpose in the same moment would land in this file too.
        let reports = read_reports(&path);
        assert!(
            reports.iter().any(|report| {
                report.contains("panic: a malformed frame")
                    && report.contains("thread: scan-worker")
            }),
            "the panic was never written down, or not with the thread that died: {reports:?}"
        );
    }
}
