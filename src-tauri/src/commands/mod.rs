//! The IPC surface.
//!
//! Command bodies stay thin on purpose: they parse arguments and delegate to a
//! domain module, so the domain stays unit-testable without a Tauri runtime.

use std::path::PathBuf;

use tauri::{Emitter, Manager, State};

use crate::audio::{Command, Player};
use crate::db::{playback, playlists, query, settings, Db};
use crate::error::AppResult;
use crate::export::{self, ExportScope};
use crate::model::{
    AppInfo, BrowseGroup, BrowseKind, FilterGroup, LibraryStats, PlayerSnapshot, Playlist,
    ScanSummary, TagEdit, TagWriteSummary, Track, TrackQuery,
};
use crate::{scan, tags};

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
