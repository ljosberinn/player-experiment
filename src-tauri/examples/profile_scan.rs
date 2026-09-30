//! Traces the scan the app would run next, without the app.
//!
//! `cargo run --release --features profile --example profile_scan [library.sqlite3]`
//!
//! Scans twice over a snapshot of the library, so one trace holds the first
//! pass, cold if the disk cache is, and a second that is warm by construction.
//! The snapshot is a SQLite backup rather than a file copy, which is safe
//! while the app has the library open; the library itself is only read, and
//! the music files are only walked and read. See `docs/knowledge/profiling.md`.

use std::path::PathBuf;
use std::time::Instant;

use apex_lib::db::Db;
use apex_lib::profile::Session;
use apex_lib::scan;
use rusqlite::{Connection, OpenFlags, MAIN_DB};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let source = match std::env::args_os().nth(1) {
        Some(path) => PathBuf::from(path),
        None => PathBuf::from(std::env::var_os("APPDATA").ok_or("APPDATA is not set")?)
            .join("dev.ljosberinn.apex")
            .join("library.sqlite3"),
    };
    let dir = std::env::temp_dir().join("apex-profile");
    std::fs::create_dir_all(&dir)?;
    let snapshot = dir.join("library.sqlite3");
    // A WAL left by the last run would be replayed over the fresh backup.
    for stale in [
        "library.sqlite3",
        "library.sqlite3-wal",
        "library.sqlite3-shm",
    ] {
        let _ = std::fs::remove_file(dir.join(stale));
    }

    let started = Instant::now();
    Connection::open_with_flags(&source, OpenFlags::SQLITE_OPEN_READ_ONLY)?
        .backup(MAIN_DB, &snapshot, None)?;
    println!(
        "snapshot of {} in {}ms",
        source.display(),
        started.elapsed().as_millis()
    );

    let session = Session::start(&dir);
    let mut conn = Db::open(&snapshot)?.conn()?;
    for pass in ["first", "second"] {
        let _pass = tracing::info_span!("pass", pass).entered();
        let started = Instant::now();
        let summary = scan::scan(&mut conn, |_| {}, |_| {})?;
        println!(
            "{pass} scan: added={} updated={} missing={} unreadable={} ms={}",
            summary.added,
            summary.updated,
            summary.missing,
            summary.unreadable,
            started.elapsed().as_millis()
        );
    }
    session.finish();
    println!("trace: {}", session.path().display());
    Ok(())
}
