//! The IPC surface.
//!
//! Command bodies stay thin on purpose: they parse arguments and delegate to a
//! domain module, so the domain stays unit-testable without a Tauri runtime.

use std::path::PathBuf;

use tauri::{Emitter, Manager, State};

use crate::db::{query, Db};
use crate::error::AppResult;
use crate::model::{AppInfo, ScanSummary, Track, TrackQuery};
use crate::scan;

pub fn app_info() -> AppInfo {
    AppInfo {
        name: env!("CARGO_PKG_NAME").to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
    }
}

#[tauri::command]
pub fn get_app_info() -> AppResult<AppInfo> {
    Ok(app_info())
}

#[tauri::command]
pub fn add_watch_folder(db: State<'_, Db>, path: String) -> AppResult<()> {
    let conn = db.conn()?;
    scan::add_watch_folder(&conn, &PathBuf::from(path))
}

#[tauri::command]
pub fn list_watch_folders(db: State<'_, Db>) -> AppResult<Vec<String>> {
    let conn = db.conn()?;
    Ok(scan::watch_folders(&conn)?
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

/// Runs a scan on a worker thread, streaming `scan://progress` as it goes.
///
/// Scanning tens of thousands of files must never occupy the IPC thread, so
/// the command returns only when the scan finishes but does its work off the
/// async runtime via `spawn_blocking`.
#[tauri::command]
pub async fn scan_library(app: tauri::AppHandle) -> AppResult<ScanSummary> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let mut conn = db.conn()?;
        scan::scan(&mut conn, |progress| {
            // A dropped progress event is not worth failing a scan over.
            let _ = app.emit("scan://progress", &progress);
        })
    })
    .await
    .map_err(|e| crate::error::AppError::Internal(format!("scan task failed: {e}")))?
}

#[tauri::command]
pub fn query_tracks(db: State<'_, Db>, query: TrackQuery) -> AppResult<Vec<Track>> {
    let conn = db.conn()?;
    query::query_tracks(&conn, &query)
}

#[tauri::command]
pub fn count_tracks(db: State<'_, Db>, query: TrackQuery) -> AppResult<u32> {
    let conn = db.conn()?;
    query::count_tracks(&conn, &query)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_crate_name_and_a_semver_version() {
        let info = app_info();
        assert_eq!(info.name, "player");
        assert_eq!(info.version.split('.').count(), 3);
    }
}
