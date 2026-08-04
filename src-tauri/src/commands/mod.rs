//! The IPC surface.
//!
//! Command bodies stay thin on purpose: they parse arguments and delegate to a
//! domain module, so the domain stays unit-testable without a Tauri runtime.

use std::path::PathBuf;

use tauri::{Emitter, Manager, State};

use crate::audio::{Command, Player};
use crate::db::{playback, playlists, query, settings, tag_values, Db};
use crate::error::AppResult;
use crate::export::{self, ExportScope};
use crate::model::{
    AppInfo, BrowseGroup, BrowseKind, CrashReport, FilterGroup, LibraryStats, PlayerSnapshot,
    Playlist, ScanSummary, TagEdit, TagValueField, TagWriteSummary, Track, TrackQuery,
};
use crate::{crash, scan, tags};

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

/// Count, total duration and total size for the current view.
///
/// The table needs the count for its scrollbar and the footer needs all three,
/// and they change together, so this is what the store calls on a query change
/// rather than asking twice.
/// Deletes the rows of files that are no longer on disk.
///
/// The only command that destroys library rows, and it exists because scanning
/// no longer does: a scan marks what it cannot find, so an unplugged drive is
/// recoverable. Throwing those rows away - and the playlist entries pointing at
/// them - is a decision, so it is a button.
#[tauri::command]
pub fn remove_missing_tracks(db: State<'_, Db>) -> AppResult<u32> {
    let conn = db.conn()?;
    scan::remove_missing(&conn)
}

#[tauri::command]
pub fn library_stats(db: State<'_, Db>, query: TrackQuery) -> AppResult<LibraryStats> {
    let conn = db.conn()?;
    query::library_stats(&conn, &query)
}

/// The albums, artists or genres inside the current view.
///
/// Takes the same `query` the songs table uses so a search or an open playlist
/// narrows both alike, and `kind` separately because which grouping to show is
/// a property of the open tab rather than of the query.
#[tauri::command]
pub fn browse_groups(
    db: State<'_, Db>,
    query: TrackQuery,
    kind: BrowseKind,
) -> AppResult<Vec<BrowseGroup>> {
    let conn = db.conn()?;
    query::browse_groups(&conn, &query, kind)
}

/// Ids of every track matching `query`, for "select all".
#[tauri::command]
pub fn all_track_ids(db: State<'_, Db>, query: TrackQuery) -> AppResult<Vec<i64>> {
    let conn = db.conn()?;
    query::all_track_ids(&conn, &query)
}

#[tauri::command]
pub fn list_playlists(db: State<'_, Db>) -> AppResult<Vec<Playlist>> {
    let conn = db.conn()?;
    playlists::list(&conn)
}

#[tauri::command]
pub fn create_playlist(db: State<'_, Db>, name: String) -> AppResult<Playlist> {
    let conn = db.conn()?;
    playlists::create(&conn, &name, crate::now_seconds())
}

/// Creates a smart playlist. Its contents are its filter, evaluated live.
#[tauri::command]
pub fn create_smart_playlist(
    db: State<'_, Db>,
    name: String,
    filter: FilterGroup,
) -> AppResult<Playlist> {
    let conn = db.conn()?;
    playlists::create_smart(&conn, &name, &filter, crate::now_seconds())
}

#[tauri::command]
pub fn set_playlist_filter(
    db: State<'_, Db>,
    playlist_id: i64,
    filter: FilterGroup,
) -> AppResult<()> {
    let conn = db.conn()?;
    playlists::set_filter(&conn, playlist_id, &filter, crate::now_seconds())
}

/// The stored filter, for the editor to open.
#[tauri::command]
pub fn playlist_filter(db: State<'_, Db>, playlist_id: i64) -> AppResult<Option<FilterGroup>> {
    let conn = db.conn()?;
    playlists::filter(&conn, playlist_id)
}

#[tauri::command]
pub fn rename_playlist(db: State<'_, Db>, playlist_id: i64, name: String) -> AppResult<()> {
    let conn = db.conn()?;
    playlists::rename(&conn, playlist_id, &name)
}

#[tauri::command]
pub fn delete_playlist(db: State<'_, Db>, playlist_id: i64) -> AppResult<()> {
    let conn = db.conn()?;
    playlists::delete(&conn, playlist_id)
}

/// Appends tracks to a playlist, returning how many were actually added.
///
/// The count is what the drop target reports: dragging ten tracks onto a
/// playlist that already holds four of them added six, and saying so is more
/// useful than claiming ten.
#[tauri::command]
pub fn add_to_playlist(db: State<'_, Db>, playlist_id: i64, track_ids: Vec<i64>) -> AppResult<u32> {
    let mut conn = db.conn()?;
    playlists::add_tracks(&mut conn, playlist_id, &track_ids)
}

#[tauri::command]
pub fn remove_from_playlist(
    db: State<'_, Db>,
    playlist_id: i64,
    track_ids: Vec<i64>,
) -> AppResult<u32> {
    let mut conn = db.conn()?;
    playlists::remove_tracks(&mut conn, playlist_id, &track_ids)
}

/// Moves tracks so they sit immediately before the row at `target_index`.
#[tauri::command]
pub fn move_in_playlist(
    db: State<'_, Db>,
    playlist_id: i64,
    track_ids: Vec<i64>,
    target_index: u32,
) -> AppResult<()> {
    let mut conn = db.conn()?;
    playlists::move_tracks(&mut conn, playlist_id, &track_ids, target_index as usize)
}

/// The rows behind a selection, so the editor can show what they hold.
///
/// Ids rather than a query: the selection survives scrolling, and the rows it
/// names may have been evicted from the frontend's page cache.
#[tauri::command]
pub fn tracks_by_ids(db: State<'_, Db>, track_ids: Vec<i64>) -> AppResult<Vec<Track>> {
    let conn = db.conn()?;
    playback::tracks_by_ids(&conn, &track_ids)
}

/// Applies one edit to every track named, reporting what it managed.
#[tauri::command]
pub fn write_tags(
    db: State<'_, Db>,
    track_ids: Vec<i64>,
    edit: TagEdit,
) -> AppResult<TagWriteSummary> {
    let mut conn = db.conn()?;
    tags::write::apply(&mut conn, &track_ids, &edit, crate::now_seconds())
}

#[tauri::command]
pub fn undo_tag_edit(db: State<'_, Db>) -> AppResult<TagWriteSummary> {
    let mut conn = db.conn()?;
    tags::write::undo_last(&mut conn)
}

#[tauri::command]
pub fn can_undo_tag_edit(db: State<'_, Db>) -> AppResult<bool> {
    let conn = db.conn()?;
    tags::write::can_undo(&conn)
}

/// Values already in the library for `field`, best match first.
///
/// The query is matched here rather than in the frontend because the answer
/// lives in SQLite and the alternative is shipping every distinct artist in a
/// 50k-track library over IPC on the chance that someone types.
#[tauri::command]
pub fn suggest_tag_values(
    db: State<'_, Db>,
    field: TagValueField,
    query: String,
) -> AppResult<Vec<String>> {
    let conn = db.conn()?;
    tag_values::suggest(&conn, field, &query, tag_values::SUGGESTION_LIMIT)
}

/// Writes an export to `path`, returning how many tracks it holds.
///
/// The file is written whole rather than streamed: an export is megabytes at
/// most, and a partial file left behind by a failure would look like a
/// complete one.
#[tauri::command]
pub fn export_library(db: State<'_, Db>, path: String, scope: ExportScope) -> AppResult<u32> {
    let conn = db.conn()?;
    let document = export::build(&conn, &scope, crate::now_seconds())?;
    let count = document.tracks.len() as u32;
    std::fs::write(&path, export::to_json(&document)?)
        .map_err(|e| crate::error::AppError::io(&path, e))?;
    Ok(count)
}

/// Opens the OS file manager with one track selected.
///
/// Takes a track id rather than a path so the frontend never has to hold a
/// path it might act on; the row it has is enough.
#[tauri::command]
pub fn reveal_track(db: State<'_, Db>, track_id: i64) -> AppResult<()> {
    let conn = db.conn()?;
    let track = playback::tracks_by_ids(&conn, &[track_id])?
        .into_iter()
        .next()
        .ok_or_else(|| {
            crate::error::AppError::NotFound("That song is not in the library.".into())
        })?;
    crate::reveal::reveal(std::path::Path::new(&track.path))
}

/// Remembers where the window is, so the next launch opens there.
/// The column layout for a view: a playlist's own, or the library's.
///
/// Returns the JSON the frontend wrote, uninterpreted. `None` means the view
/// has never been configured, which the caller resolves to the global layout -
/// a playlist that starts bare rather than inheriting would be a worse default
/// than any layout.
#[tauri::command]
pub fn load_column_config(
    db: State<'_, Db>,
    playlist_id: Option<i64>,
) -> AppResult<Option<String>> {
    let conn = db.conn()?;
    match playlist_id {
        Some(id) => playlists::columns(&conn, id),
        None => settings::get(&conn, settings::COLUMNS),
    }
}

#[tauri::command]
pub fn save_column_config(
    db: State<'_, Db>,
    playlist_id: Option<i64>,
    config_json: String,
) -> AppResult<()> {
    let conn = db.conn()?;
    match playlist_id {
        Some(id) => playlists::set_columns(&conn, id, &config_json),
        None => settings::set(&conn, settings::COLUMNS, &config_json),
    }
}

/// The stored webview zoom factor, or null if never set.
///
/// Kept beside the window geometry rather than with the column layout: it is
/// a property of the window, and like geometry it has to be applied before
/// the window is shown or the user watches the app resize itself.
#[tauri::command]
pub fn load_zoom(db: State<'_, Db>) -> AppResult<Option<String>> {
    let conn = db.conn()?;
    settings::get(&conn, settings::ZOOM)
}

#[tauri::command]
pub fn save_zoom(db: State<'_, Db>, factor: String) -> AppResult<()> {
    let conn = db.conn()?;
    settings::set(&conn, settings::ZOOM, &factor)
}

#[tauri::command]
pub fn save_window_geometry(db: State<'_, Db>, geometry: String) -> AppResult<()> {
    let conn = db.conn()?;
    settings::set(&conn, settings::WINDOW_GEOMETRY, &geometry)
}

#[tauri::command]
pub fn load_window_geometry(db: State<'_, Db>) -> AppResult<Option<String>> {
    let conn = db.conn()?;
    settings::get(&conn, settings::WINDOW_GEOMETRY)
}

/// Replaces the play queue and starts at `index`.
///
/// Takes ids rather than rows: the frontend already has the ordered id list
/// for the current view (the same one "select all" uses), and paths and
/// durations are looked up here so the queue cannot disagree with the library.
#[tauri::command]
pub fn player_play(
    db: State<'_, Db>,
    player: State<'_, Player>,
    track_ids: Vec<i64>,
    index: u32,
) -> AppResult<()> {
    let conn = db.conn()?;
    let entries = playback::queue_entries(&conn, &track_ids)?;
    player.send(Command::SetQueue {
        entries,
        index: index as usize,
    })
}

#[tauri::command]
pub fn player_toggle(player: State<'_, Player>) -> AppResult<()> {
    player.send(Command::Toggle)
}

#[tauri::command]
pub fn player_pause(player: State<'_, Player>) -> AppResult<()> {
    player.send(Command::Pause)
}

#[tauri::command]
pub fn player_resume(player: State<'_, Player>) -> AppResult<()> {
    player.send(Command::Resume)
}

#[tauri::command]
pub fn player_stop(player: State<'_, Player>) -> AppResult<()> {
    player.send(Command::Stop)
}

#[tauri::command]
pub fn player_next(player: State<'_, Player>) -> AppResult<()> {
    player.send(Command::Next)
}

#[tauri::command]
pub fn player_previous(player: State<'_, Player>) -> AppResult<()> {
    player.send(Command::Previous)
}

#[tauri::command]
pub fn player_seek(player: State<'_, Player>, position_ms: i64) -> AppResult<()> {
    player.send(Command::Seek { position_ms })
}

/// Sets the volume and remembers it for the next launch.
#[tauri::command]
pub fn player_set_volume(
    db: State<'_, Db>,
    player: State<'_, Player>,
    volume: f32,
) -> AppResult<()> {
    player.send(Command::SetVolume(volume))?;
    // Persisted here rather than in the event callback: this is the only place
    // volume changes, and it keeps the audio thread off the database.
    let conn = db.conn()?;
    settings::set(&conn, settings::VOLUME, &volume.clamp(0.0, 1.0).to_string())
}

/// The current state, for a window that has just opened and missed the events.
#[tauri::command]
pub fn player_snapshot(db: State<'_, Db>, player: State<'_, Player>) -> AppResult<PlayerSnapshot> {
    let conn = db.conn()?;
    playback::snapshot(&conn, &player.state())
}

/// Writes `count` synthetic rows into the library. **Test-only.**
///
/// The e2e suite's way of getting to a library size no fixture folder can
/// reach: a hundred and fifty thousand files on disk would be gigabytes and
/// minutes to produce a worse test than inserting the rows the scanner would
/// have produced. What is under test there is the table - that the DOM stays
/// bounded and the last page is reachable - not ingest, which the seeded
/// library spec covers with real files.
///
/// A shipped build cannot run this: `e2e_only` is a bare `Err` there, because
/// the code that could say yes is behind the `wdio` feature and is not
/// compiled in. The command still exists in that build, and answers by
/// refusing.
#[tauri::command]
pub async fn seed_synthetic_tracks(app: tauri::AppHandle, count: u32) -> AppResult<u32> {
    crate::e2e_only("seed_synthetic_tracks")?;

    // Off the IPC thread: a hundred and fifty thousand inserts is seconds of
    // work, and blocking there would stall every other command behind it.
    let seeded = tauri::async_runtime::spawn_blocking(move || -> AppResult<u32> {
        let db = app.state::<Db>();
        let mut conn = db.conn()?;
        let seeded = crate::db::synthetic::seed(&mut conn, count)?;
        // What tells the open view to re-count and re-fetch. Without it the
        // table would keep the row count it had before the insert.
        let _ = app.emit("library://changed", ());
        Ok(seeded)
    })
    .await
    .map_err(|e| crate::error::AppError::Internal(format!("seed task failed: {e}")))?;

    seeded
}

/// The panic the previous run wrote down, if the user has not seen it yet.
///
/// Filtered here rather than in the frontend so that "already dismissed" is
/// one fact in one place: the notice is shown once per crash, not at every
/// launch after one.
#[tauri::command]
pub fn last_crash(db: State<'_, Db>) -> AppResult<Option<CrashReport>> {
    let path = crash::log_path(crash_dir(&db));
    let Some(report) = crash::latest(&path) else {
        return Ok(None);
    };

    let conn = db.conn()?;
    let seen = settings::get(&conn, settings::CRASH_SEEN)?
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    if report.when <= seen {
        return Ok(None);
    }

    Ok(Some(CrashReport {
        when: report.when,
        summary: report.summary().to_owned(),
        details: report.text,
        path: path.to_string_lossy().into_owned(),
    }))
}

/// Marks every crash up to `when` as seen.
#[tauri::command]
pub fn acknowledge_crash(db: State<'_, Db>, when: i64) -> AppResult<()> {
    let conn = db.conn()?;
    settings::set(&conn, settings::CRASH_SEEN, &when.to_string())
}

/// Opens the file manager with the crash log selected.
///
/// The route to the reports older than the one the notice shows, which is why
/// it reveals the file rather than rendering its contents.
#[tauri::command]
pub fn reveal_crash_log(db: State<'_, Db>) -> AppResult<()> {
    crate::reveal::reveal(&crash::log_path(crash_dir(&db)))
}

/// Where the crash log lives: beside the database, whatever directory that is.
///
/// Derived from the database path rather than asked of Tauri again, so the two
/// cannot drift apart - including in an e2e build, where the data directory is
/// overridden.
fn crash_dir(db: &Db) -> &std::path::Path {
    db.path()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_synthetic_seed_is_refused_outside_a_test_build() {
        // `cargo test` builds without the `wdio` feature, which is the same
        // build a user installs. If this ever starts returning `Ok`, a command
        // that writes a hundred and fifty thousand rows has become reachable
        // from a shipped binary.
        assert!(crate::e2e_only("seed_synthetic_tracks").is_err());
    }

    #[test]
    fn reports_the_crate_name_and_a_semver_version() {
        let info = app_info();
        assert_eq!(info.name, "player");
        assert_eq!(info.version.split('.').count(), 3);
    }
}
