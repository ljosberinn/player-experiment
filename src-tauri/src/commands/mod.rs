//! The IPC surface.
//!
//! Command bodies stay thin on purpose: they parse arguments and delegate to a
//! domain module, so the domain stays unit-testable without a Tauri runtime.

mod invalidate;

use std::path::PathBuf;

use tauri::{Emitter, Manager, State};

pub(crate) use invalidate::{announce as announce_library_changed, Invalidations};

use crate::audio::{Command, Player};
use crate::db::{playback, playlists, query, settings, tag_values, Db};
use crate::error::AppResult;
use crate::export::{self, ExportScope};
use crate::log::{Fields, Log, Op};
use crate::model::{
    AppInfo, BrowseGroup, BrowseKind, CoverEdit, CrashReport, FilterGroup, LastfmConnection,
    LastfmStatus, LibraryStats, PlayerSnapshot, Playlist, ReleaseCandidate, ReleaseDetail,
    ReleaseIdentity, ReleaseSelection, ScanSummary, SmartOrder, TagEdit, TagValueField,
    TagWriteSummary, Track, TrackEdit, TrackQuery,
};
use crate::scan::ScanLock;
use crate::{crash, lastfm, scan, tags, tagsource};

/// Progress channels for the writes long enough to watch.
const TAG_PROGRESS: &str = "tags://progress";
const EXPORT_PROGRESS: &str = "export://progress";
/// Named rather than inline since the unattended pass in `lib.rs` reports on
/// it too - the bar does not care which of the two started the work.
pub(crate) const SCAN_PROGRESS: &str = "scan://progress";

/// The one channel that says the library is no longer what a view thinks.
///
/// A bare ping with no payload. Scope was considered and declined: nearly
/// every write changes both the tracks and the playlists - a tag edit moves
/// smart playlist membership, a playlist edit changes the open view - so a
/// payload would say `true, true` at almost every site while being one more
/// thing two stores have to agree on.
///
/// Emitted only through [`invalidate::announce`], which coalesces it: see that
/// module for why a long write must not be one ping per commit.
pub(crate) const LIBRARY_CHANGED: &str = "library://changed";

/// Runs a write, writes it down, and announces it, so no caller has to
/// remember to do any of the three.
///
/// Announced only on success: a rejected filter or a name collision changed
/// nothing, and telling every view to re-query over it is work for no reason.
/// A dropped event is not worth failing a write that has already committed.
/// The log line goes out either way - a write that failed is the one somebody
/// will be looking for.
fn announcing<T>(
    app: &tauri::AppHandle,
    op: Op,
    write: impl FnOnce() -> AppResult<T>,
) -> AppResult<T> {
    let done = op.run(write)?;
    invalidate::announce(app);
    Ok(done)
}

/// [`announcing`], for a write whose counts only its result knows.
fn announcing_with<T>(
    app: &tauri::AppHandle,
    op: Op,
    write: impl FnOnce() -> AppResult<T>,
    fields: impl FnOnce(&T) -> Fields,
) -> AppResult<T> {
    let done = op.run_with(write, fields)?;
    invalidate::announce(app);
    Ok(done)
}

/// The line this command leaves behind in `main.log`.
///
/// Reached through the app handle rather than taken as a parameter, because
/// every command that announces already holds one. A read has nothing to
/// announce, so it takes the log itself.
fn op(app: &tauri::AppHandle, name: &'static str) -> Op {
    app.state::<Log>().op(name)
}

/// Runs `work` off the async runtime, naming the task if the thread dies.
///
/// Four commands do enough file I/O to freeze the window on the IPC thread -
/// scanning, a tag write, its undo, and an export - and each one needs the
/// same three lines around `spawn_blocking`. `what` appears only in the join
/// failure, which is a panic in the worker: without it every such failure
/// reads the same and says nothing about which one it was.
async fn blocking<T: Send + 'static>(
    what: &'static str,
    work: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("{what} task failed: {e}")))?
}

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
pub fn add_watch_folder(log: State<'_, Log>, db: State<'_, Db>, path: String) -> AppResult<()> {
    log.op("watch.add").add("path", &path).run(|| {
        let conn = db.conn()?;
        scan::add_watch_folder(&conn, &PathBuf::from(path))
    })
}

#[tauri::command]
pub fn list_watch_folders(log: State<'_, Log>, db: State<'_, Db>) -> AppResult<Vec<String>> {
    log.op("watch.list").quiet().run(|| {
        let conn = db.conn()?;
        Ok(scan::watch_folders(&conn)?
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect())
    })
}

/// Stops watching a folder. The songs already in the library stay.
///
/// No `library://changed`: the list this changes is the one in Settings, and
/// the tracks are exactly as they were until a pass does not find them.
#[tauri::command]
pub fn remove_watch_folder(log: State<'_, Log>, db: State<'_, Db>, path: String) -> AppResult<()> {
    log.op("watch.remove").add("path", &path).run(|| {
        let conn = db.conn()?;
        scan::remove_watch_folder(&conn, &PathBuf::from(path))
    })
}

/// Runs a scan on a worker thread, streaming `scan://progress` as it goes.
///
/// Scanning tens of thousands of files must never occupy the IPC thread, so
/// the command returns only when the scan finishes but does its work off the
/// async runtime via `spawn_blocking`.
#[tauri::command]
pub async fn scan_library(app: tauri::AppHandle) -> AppResult<ScanSummary> {
    blocking("scan", move || {
        let db = app.state::<Db>();
        // Waits, unlike the unattended pass, which skips: the user asked for
        // this answer, and a Rescan that silently did nothing is worse than
        // one that starts its walk late.
        let lock = app.state::<ScanLock>();
        let _guard = lock.acquire();
        let mut conn = db.conn()?;
        // Announced once at the end rather than per file: `scan://progress`
        // already drives the bar, and a ping per file would put one re-query
        // per file behind it.
        announcing_with(
            &app,
            op(&app, "scan"),
            || {
                scan::scan(&mut conn, |progress| {
                    // A dropped progress event is not worth failing a scan over.
                    let _ = app.emit(SCAN_PROGRESS, &progress);
                })
            },
            scan::summary_fields,
        )
    })
    .await
}

#[tauri::command]
pub fn query_tracks(
    log: State<'_, Log>,
    db: State<'_, Db>,
    query: TrackQuery,
) -> AppResult<Vec<Track>> {
    log.op("tracks.query").quiet().run(|| {
        let conn = db.conn()?;
        query::query_tracks(&conn, &query)
    })
}

#[tauri::command]
pub fn count_tracks(log: State<'_, Log>, db: State<'_, Db>, query: TrackQuery) -> AppResult<u32> {
    log.op("tracks.count").quiet().run(|| {
        let conn = db.conn()?;
        query::count_tracks(&conn, &query)
    })
}

/// Count, total duration and total size for the current view.
///
/// The table needs the count for its scrollbar and the footer needs all three,
/// and they change together, so this is what the store calls on a query change
/// rather than asking twice.
/// Deletes the rows of files that are no longer on disk.
///
/// It exists because scanning no longer does: a scan marks what it cannot find,
/// so an unplugged drive is recoverable. Throwing those rows away - and the
/// playlist entries pointing at them - is a decision, so it is a button.
///
/// No tombstones: see `scan::remove_missing`.
#[tauri::command]
pub fn remove_missing_tracks(app: tauri::AppHandle, db: State<'_, Db>) -> AppResult<u32> {
    announcing_with(
        &app,
        op(&app, "tracks.remove_missing"),
        || {
            let conn = db.conn()?;
            scan::remove_missing(&conn)
        },
        |removed| Fields::new().add("removed", removed),
    )
}

/// Deletes the named rows and tombstones their paths, leaving the files alone.
///
/// The other command that destroys library rows, and the one the user reaches
/// per row rather than per condition. The tombstone is what makes it stick: the
/// file is still under a watch folder, so a rescan would otherwise add it back.
#[tauri::command]
pub fn remove_tracks(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    track_ids: Vec<i64>,
) -> AppResult<u32> {
    announcing_with(
        &app,
        op(&app, "tracks.remove").add("tracks", track_ids.len()),
        || {
            let mut conn = db.conn()?;
            scan::remove_tracks(&mut conn, &track_ids)
        },
        |removed| Fields::new().add("removed", removed),
    )
}

/// Drops every tombstone, so the next scan finds those files again.
///
/// Announced like a write even though no row moved: the count behind File ▸
/// Forget Removed Songs comes off `library_stats`, and the entry has to stop
/// offering itself once there is nothing left to forget.
#[tauri::command]
pub fn forget_removed_tracks(app: tauri::AppHandle, db: State<'_, Db>) -> AppResult<u32> {
    announcing_with(
        &app,
        op(&app, "tracks.forget_removed"),
        || {
            let conn = db.conn()?;
            scan::forget_removed(&conn)
        },
        |forgotten| Fields::new().add("forgotten", forgotten),
    )
}

#[tauri::command]
pub fn library_stats(
    log: State<'_, Log>,
    db: State<'_, Db>,
    query: TrackQuery,
) -> AppResult<LibraryStats> {
    log.op("tracks.stats").quiet().run(|| {
        let conn = db.conn()?;
        query::library_stats(&conn, &query)
    })
}

/// The albums, artists or genres inside the current view.
///
/// Takes the same `query` the songs table uses so a search or an open playlist
/// narrows both alike, and `kind` separately because which grouping to show is
/// a property of the open tab rather than of the query.
#[tauri::command]
pub fn browse_groups(
    log: State<'_, Log>,
    db: State<'_, Db>,
    query: TrackQuery,
    kind: BrowseKind,
) -> AppResult<Vec<BrowseGroup>> {
    log.op("tracks.browse").quiet().run(|| {
        let conn = db.conn()?;
        query::browse_groups(&conn, &query, kind)
    })
}

/// Ids of every track matching `query`, for "select all".
#[tauri::command]
pub fn all_track_ids(
    log: State<'_, Log>,
    db: State<'_, Db>,
    query: TrackQuery,
) -> AppResult<Vec<i64>> {
    log.op("tracks.all_ids").quiet().run(|| {
        let conn = db.conn()?;
        query::all_track_ids(&conn, &query)
    })
}

#[tauri::command]
pub fn list_playlists(log: State<'_, Log>, db: State<'_, Db>) -> AppResult<Vec<Playlist>> {
    log.op("playlist.list").quiet().run(|| {
        let conn = db.conn()?;
        playlists::list(&conn)
    })
}

#[tauri::command]
pub fn create_playlist(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    name: String,
) -> AppResult<Playlist> {
    announcing(&app, op(&app, "playlist.create"), || {
        let conn = db.conn()?;
        playlists::create(&conn, &name, crate::now_seconds())
    })
}

/// Creates a smart playlist. Its contents are its filter and cutoff, evaluated
/// live.
#[tauri::command]
pub fn create_smart_playlist(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    name: String,
    filter: FilterGroup,
    order: SmartOrder,
) -> AppResult<Playlist> {
    announcing(&app, op(&app, "playlist.create_smart"), || {
        let conn = db.conn()?;
        playlists::create_smart(&conn, &name, &filter, &order, crate::now_seconds())
    })
}

#[tauri::command]
pub fn set_playlist_filter(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    playlist_id: i64,
    filter: FilterGroup,
    order: SmartOrder,
) -> AppResult<()> {
    announcing(
        &app,
        op(&app, "playlist.set_filter").add("id", playlist_id),
        || {
            let conn = db.conn()?;
            playlists::set_smart(&conn, playlist_id, &filter, &order, crate::now_seconds())
        },
    )
}

/// The stored filter, for the editor to open.
#[tauri::command]
pub fn playlist_filter(
    log: State<'_, Log>,
    db: State<'_, Db>,
    playlist_id: i64,
) -> AppResult<Option<FilterGroup>> {
    log.op("playlist.filter").quiet().run(|| {
        let conn = db.conn()?;
        playlists::filter(&conn, playlist_id)
    })
}

/// The stored order and cutoff, for the editor to open and for the songs table
/// to know which column a playlist should arrive sorted by.
#[tauri::command]
pub fn playlist_order(
    log: State<'_, Log>,
    db: State<'_, Db>,
    playlist_id: i64,
) -> AppResult<SmartOrder> {
    log.op("playlist.order").quiet().run(|| {
        let conn = db.conn()?;
        playlists::order(&conn, playlist_id)
    })
}

#[tauri::command]
pub fn rename_playlist(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    playlist_id: i64,
    name: String,
) -> AppResult<()> {
    announcing(
        &app,
        op(&app, "playlist.rename").add("id", playlist_id),
        || {
            let conn = db.conn()?;
            playlists::rename(&conn, playlist_id, &name)
        },
    )
}

#[tauri::command]
pub fn delete_playlist(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    playlist_id: i64,
) -> AppResult<()> {
    announcing(
        &app,
        op(&app, "playlist.delete").add("id", playlist_id),
        || {
            let conn = db.conn()?;
            playlists::delete(&conn, playlist_id)
        },
    )
}

/// Appends tracks to a playlist, returning how many were actually added.
///
/// The count is what the drop target reports: dragging ten tracks onto a
/// playlist that already holds four of them added six, and saying so is more
/// useful than claiming ten.
#[tauri::command]
pub fn add_to_playlist(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    playlist_id: i64,
    track_ids: Vec<i64>,
) -> AppResult<u32> {
    announcing_with(
        &app,
        op(&app, "playlist.add")
            .add("id", playlist_id)
            .add("tracks", track_ids.len()),
        || {
            let mut conn = db.conn()?;
            playlists::add_tracks(&mut conn, playlist_id, &track_ids)
        },
        |added| Fields::new().add("added", added),
    )
}

#[tauri::command]
pub fn remove_from_playlist(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    playlist_id: i64,
    track_ids: Vec<i64>,
) -> AppResult<u32> {
    announcing_with(
        &app,
        op(&app, "playlist.remove")
            .add("id", playlist_id)
            .add("tracks", track_ids.len()),
        || {
            let mut conn = db.conn()?;
            playlists::remove_tracks(&mut conn, playlist_id, &track_ids)
        },
        |removed| Fields::new().add("removed", removed),
    )
}

/// Moves tracks so they sit immediately before the row at `target_index`.
#[tauri::command]
pub fn move_in_playlist(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    playlist_id: i64,
    track_ids: Vec<i64>,
    target_index: u32,
) -> AppResult<()> {
    announcing(
        &app,
        op(&app, "playlist.move")
            .add("id", playlist_id)
            .add("tracks", track_ids.len()),
        || {
            let mut conn = db.conn()?;
            playlists::move_tracks(&mut conn, playlist_id, &track_ids, target_index as usize)
        },
    )
}

/// The rows behind a selection, so the editor can show what they hold.
///
/// Ids rather than a query: the selection survives scrolling, and the rows it
/// names may have been evicted from the frontend's page cache.
#[tauri::command]
pub fn tracks_by_ids(
    log: State<'_, Log>,
    db: State<'_, Db>,
    track_ids: Vec<i64>,
) -> AppResult<Vec<Track>> {
    log.op("tracks.by_ids").quiet().run(|| {
        let conn = db.conn()?;
        playback::tracks_by_ids(&conn, &track_ids)
    })
}

/// Applies one edit to every track named, reporting what it managed.
///
/// On a worker thread, streaming `tags://progress`: each file is a whole mp3
/// copied and replaced, so 500 of them held the window still for as long as
/// the batch took.
#[tauri::command]
pub async fn write_tags(
    app: tauri::AppHandle,
    track_ids: Vec<i64>,
    edit: TagEdit,
) -> AppResult<TagWriteSummary> {
    // Started before the work moves onto the worker, so `ms=` covers the whole
    // batch rather than the part of it after the thread started.
    let op = op(&app, "tags.write").add("tracks", track_ids.len());
    let op = match &edit.cover {
        Some(CoverEdit::Remove) => op.add("cover", "removed"),
        Some(CoverEdit::Replace { .. }) => op.add("cover", "replaced"),
        None => op,
    };

    blocking("tag write", move || {
        let db = app.state::<Db>();
        let mut conn = db.conn()?;
        // Once, when the batch returns. `TAG_PROGRESS` stays per track.
        announcing_with(
            &app,
            op,
            || {
                tags::write::apply_to_each(
                    &mut conn,
                    &track_ids,
                    &edit,
                    crate::now_seconds(),
                    |p| {
                        // A dropped progress event is not worth failing a write over.
                        let _ = app.emit(TAG_PROGRESS, &p);
                    },
                )
            },
            written_fields,
        )
    })
    .await
}

/// What a tag write or its undo managed, for the log.
///
/// `failed` is always written, zero included: "17 written" and "17 written, 3
/// refused" are different outcomes and the line has to distinguish them.
fn written_fields(summary: &TagWriteSummary) -> Fields {
    Fields::new()
        .add("written", summary.written)
        .add("failed", summary.failed)
}

/// The staged cover's file name, minus the extension the sniff decides.
///
/// One name, so a second choice overwrites the first: the file is needed only
/// until the save reads it back, and a name per choice would leave a cache
/// full of album covers behind.
const STAGED_COVER_STEM: &str = "chosen-cover";

/// The one path under `cover://` that is not a hash.
///
/// What the editor is about to write rather than what is in the library, so it
/// answers from the staging file instead of from `covers`.
pub(crate) const STAGED_COVER: &str = "staged";

/// Writes a dropped image into the cache directory and hands back its path.
///
/// The editor's cover travels as a path - `CoverEdit::Replace` - and an HTML5
/// drop gives the page a `File`, which is bytes and no path: the native event
/// that carries paths needs `dragDropEnabled`, which would kill in-app
/// dragging. Staging is what turns one into the other, so a drop lands in the
/// same state the picker produces and nothing downstream of `CoverEdit` has to
/// know a drop happened.
///
/// The bytes arrive as the *whole* invoke payload, which is the only shape
/// Tauri sends raw; a `Uint8Array` inside an args object is JSON, one number
/// per byte. A JSON body here is therefore a caller that has lost the raw
/// route, and is an error rather than something to decode.
///
/// Not on a worker thread, unlike the writes above: the body is a `&` into the
/// message, so moving it would mean copying up to 12 MB to save a single write
/// of the same bytes.
#[tauri::command]
pub fn stage_dropped_cover(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> AppResult<String> {
    op(&app, "cover.stage_dropped").run(|| {
        let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
            return Err(crate::error::AppError::Internal(
                "A dropped image has to arrive as raw bytes.".to_owned(),
            ));
        };
        stage_cover(&staging_dir(&app)?, bytes)
    })
}

/// Copies a picked image into the same staging file, and hands back its path.
///
/// The picker's own path would do for the save - it did until this phase - but
/// only what the backend can serve can be previewed, and the webview cannot
/// read an arbitrary path. Staging both routes is also what makes a picked
/// image refused while the dialog is open rather than at save time.
#[tauri::command]
pub fn stage_picked_cover(app: tauri::AppHandle, path: String) -> AppResult<String> {
    op(&app, "cover.stage_picked").add("path", &path).run(|| {
        let bytes = std::fs::read(&path).map_err(|e| crate::error::AppError::io(&path, e))?;
        stage_cover(&staging_dir(&app)?, &bytes)
    })
}

/// The staged image, for the `cover://staged` route: its mime and its bytes.
///
/// `None` covers every way there is nothing to show - no directory, no file,
/// or a file that is no longer an image - because the answer to all three is
/// the same 404.
pub(crate) fn staged_cover(app: &tauri::AppHandle) -> Option<(String, Vec<u8>)> {
    let dir = app.path().app_cache_dir().ok()?;
    ["image/png", "image/jpeg"]
        .into_iter()
        .filter_map(|mime| std::fs::read(staged_cover_path(&dir, mime)).ok())
        // Sniffed rather than taken from the name that was just matched: the
        // extension is a label this app wrote, and the bytes outrank it.
        .find_map(|bytes| Some((tags::write::check_cover(&bytes).ok()?.to_owned(), bytes)))
}

/// The cache directory, made if it is not there yet.
fn staging_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| crate::error::AppError::Internal(format!("no cache directory: {e}")))?;
    std::fs::create_dir_all(&dir).map_err(|e| crate::error::AppError::io(dir.display(), e))?;
    Ok(dir)
}

/// Checks `bytes` and writes them to the one staging file, returning its path.
fn stage_cover(dir: &std::path::Path, bytes: &[u8]) -> AppResult<String> {
    let mime = tags::write::check_cover(bytes)?;

    let staged = staged_cover_path(dir, mime);
    std::fs::write(&staged, bytes).map_err(|e| crate::error::AppError::io(staged.display(), e))?;
    // The other format's file, left by an earlier choice. Without this the
    // fixed name holds once per extension rather than once for the staging
    // area - and `staged_cover` would have two files to choose between.
    let other = if mime == "image/png" {
        "image/jpeg"
    } else {
        "image/png"
    };
    let _ = std::fs::remove_file(staged_cover_path(dir, other));

    Ok(staged.to_string_lossy().into_owned())
}

/// Where a cover of `mime` is staged, named for what the bytes turned out to
/// be rather than for what the chosen file was called.
fn staged_cover_path(dir: &std::path::Path, mime: &str) -> PathBuf {
    let extension = if mime == "image/png" { "png" } else { "jpg" };
    dir.join(format!("{STAGED_COVER_STEM}.{extension}"))
}

/// Reverts the last edit, on a worker thread for the same reason.
#[tauri::command]
pub async fn undo_tag_edit(app: tauri::AppHandle) -> AppResult<TagWriteSummary> {
    blocking("tag undo", move || {
        let db = app.state::<Db>();
        // Behind the same lock as a scan: it rewrites the files a pass reads
        // its (mtime, size) from, and until the lock existed nothing stopped
        // the two from running over each other.
        let lock = app.state::<ScanLock>();
        let _guard = lock.acquire();
        let mut conn = db.conn()?;
        announcing_with(
            &app,
            op(&app, "tags.undo"),
            || {
                tags::write::undo_last(&mut conn, |p| {
                    let _ = app.emit(TAG_PROGRESS, &p);
                })
            },
            written_fields,
        )
    })
    .await
}

#[tauri::command]
pub fn can_undo_tag_edit(log: State<'_, Log>, db: State<'_, Db>) -> AppResult<bool> {
    log.op("tags.can_undo").quiet().run(|| {
        let conn = db.conn()?;
        tags::write::can_undo(&conn)
    })
}

/// The releases a selection covers, in the order they are worked through.
///
/// The first thing the lookup does, and the reason it is worth doing at all: a
/// selection of a thousand files is a hundred-odd releases, and MusicBrainz
/// allows one request a second.
#[tauri::command]
pub fn tagsource_groups(
    log: State<'_, Log>,
    db: State<'_, Db>,
    track_ids: Vec<i64>,
) -> AppResult<Vec<ReleaseSelection>> {
    log.op("tagsource.groups")
        .add("tracks", track_ids.len())
        .run(|| {
            let conn = db.conn()?;
            query::release_selections(&conn, &track_ids)
        })
}

/// The transport, or a sentence saying why there is none.
fn tagsource_ready() -> AppResult<&'static tagsource::transport::HttpTransport> {
    tagsource::transport::shared().ok_or_else(|| {
        crate::error::AppError::Internal("This machine has no usable HTTP client.".to_owned())
    })
}

/// The release as it is on disk, which is what a candidate is scored against.
///
/// Read here rather than sent from the dialog because the dialog only knows
/// the files that were selected, and three files out of twelve would score
/// every twelve-track candidate as a mismatch.
fn local_release(
    conn: &rusqlite::Connection,
    album: Option<&str>,
    artist: Option<&str>,
) -> AppResult<tagsource::score::LocalRelease> {
    let members = query::release_members(conn, album, artist)?;
    Ok(tagsource::score::LocalRelease {
        track_count: u32::try_from(members.len()).unwrap_or(u32::MAX),
        durations_ms: members
            .into_iter()
            .map(|member| member.duration_ms)
            .collect(),
    })
}

/// Searches MusicBrainz for the release these files might be.
///
/// On a worker thread because it blocks twice over: once on the shared rate
/// limiter, which holds every caller to one request a second, and once on the
/// request itself.
#[tauri::command]
pub async fn tagsource_search(
    app: tauri::AppHandle,
    album: Option<String>,
    artist: Option<String>,
) -> AppResult<Vec<ReleaseCandidate>> {
    let op = op(&app, "tagsource.search")
        .add("album", album.as_deref().unwrap_or("-"))
        .add("artist", artist.as_deref().unwrap_or("-"));

    blocking("release search", move || {
        op.run_with(
            || {
                let conn = app.state::<Db>().conn()?;
                let local = local_release(&conn, album.as_deref(), artist.as_deref())?;
                // Dropped before the network call: a connection held across a
                // rate-limited second is a connection nothing else can use.
                drop(conn);
                tagsource::musicbrainz::search(
                    tagsource_ready()?,
                    album.as_deref(),
                    artist.as_deref(),
                    &local,
                )
            },
            |candidates| Fields::new().add("candidates", candidates.len()),
        )
    })
    .await
}

/// Reads one candidate's tracklist, and its cover beside it.
///
/// `album` and `artist` are the local release again, because the score is
/// recomputed here: the durations that separate two pressings of one album do
/// not exist until the tracklist does.
#[tauri::command]
pub async fn tagsource_fetch(
    app: tauri::AppHandle,
    mbid: String,
    album: Option<String>,
    artist: Option<String>,
) -> AppResult<ReleaseDetail> {
    let op = op(&app, "tagsource.fetch").add("mbid", &mbid);

    blocking("release fetch", move || {
        op.run_with(
            || {
                let conn = app.state::<Db>().conn()?;
                let local = local_release(&conn, album.as_deref(), artist.as_deref())?;
                drop(conn);

                let (mut detail, cover) =
                    tagsource::fetch_release(tagsource_ready()?, &mbid, &local)?;
                // Through the same staging file the tag editor's own artwork
                // goes through, so the dialog previews it over `cover://` and
                // the writer reads it back the one way it already knows.
                detail.cover_path = match cover {
                    Some(bytes) => stage_cover(&staging_dir(&app)?, &bytes).ok(),
                    None => None,
                };
                Ok(detail)
            },
            |detail| {
                Fields::new()
                    .add("tracks", detail.tracks.len())
                    .add("cover", detail.cover_path.is_some())
            },
        )
    })
    .await
}

/// Writes a confirmed lookup: the mapped fields, and the release's identity.
///
/// One batch, so undo takes the whole release back in one step - which is the
/// entire reason [`tags::write::apply`] takes an edit per track.
///
/// The identifiers are the exception to the selection: every file of the
/// release gets them, selected or not. Otherwise three of twelve tracks would
/// carry an identity and nine would fall back to their title, and the release
/// would be drawn twice by anything that groups on it.
#[tauri::command]
pub async fn tagsource_apply(
    app: tauri::AppHandle,
    edits: Vec<TrackEdit>,
    identity: ReleaseIdentity,
) -> AppResult<TagWriteSummary> {
    let op = op(&app, "tagsource.apply")
        .add("tracks", edits.len())
        .add("release", &identity.release_mbid);

    blocking("release apply", move || {
        let db = app.state::<Db>();
        // Behind the same lock as a scan and an undo: it rewrites the files a
        // pass reads its (mtime, size) from.
        let lock = app.state::<ScanLock>();
        let _guard = lock.acquire();
        let mut conn = db.conn()?;

        let members =
            query::release_members(&conn, identity.album.as_deref(), identity.artist.as_deref())?;
        let edits = with_identity(edits, &members, &identity);

        announcing_with(
            &app,
            op,
            || {
                tags::write::apply(&mut conn, &edits, crate::now_seconds(), |p| {
                    let _ = app.emit(TAG_PROGRESS, &p);
                })
            },
            written_fields,
        )
    })
    .await
}

/// Stamps the release's identifiers onto every file of it.
///
/// The mapped edits keep everything the dialog put in them and gain the two
/// ids; every other file of the release gets an edit that carries nothing
/// else, so a file nobody selected is written for its identity and for nothing
/// else. Absent fields still mean "leave alone", so such an edit changes two
/// tags and no others.
fn with_identity(
    edits: Vec<TrackEdit>,
    members: &[query::ReleaseMember],
    identity: &ReleaseIdentity,
) -> Vec<(i64, TagEdit)> {
    let stamp = |mut edit: TagEdit| {
        edit.release_mbid = Some(identity.release_mbid.clone());
        edit.release_group_mbid = identity.release_group_mbid.clone();
        edit
    };

    let mut applied: Vec<(i64, TagEdit)> = edits
        .into_iter()
        .map(|edit| (edit.track_id, stamp(edit.edit)))
        .collect();

    let mapped: std::collections::HashSet<i64> = applied.iter().map(|(id, _)| *id).collect();
    applied.extend(
        members
            .iter()
            .filter(|member| !mapped.contains(&member.id))
            .map(|member| (member.id, stamp(TagEdit::default()))),
    );
    applied
}

/// Values already in the library for `field`, best match first.
///
/// The query is matched here rather than in the frontend because the answer
/// lives in SQLite and the alternative is shipping every distinct artist in a
/// 50k-track library over IPC on the chance that someone types.
#[tauri::command]
pub fn suggest_tag_values(
    log: State<'_, Log>,
    db: State<'_, Db>,
    field: TagValueField,
    query: String,
) -> AppResult<Vec<String>> {
    log.op("tags.suggest").quiet().run(|| {
        let conn = db.conn()?;
        tag_values::suggest(&conn, field, &query, tag_values::SUGGESTION_LIMIT)
    })
}

/// Writes an export to `path`, returning how many tracks it holds.
///
/// The file is still written whole rather than streamed: an export is
/// megabytes at most, and a partial file left behind by a failure would look
/// like a complete one. What moved is where that happens - the whole document
/// is built and serialized on a worker thread, streaming `export://progress`,
/// because building it in the command handler stopped the window at the moment
/// the user picked a filename.
#[tauri::command]
pub async fn export_library(
    app: tauri::AppHandle,
    path: String,
    scope: ExportScope,
) -> AppResult<u32> {
    let op = op(&app, "export").add("path", &path);

    blocking("export", move || {
        op.run_with(
            || {
                let db = app.state::<Db>();
                let conn = db.conn()?;
                let document = export::build(&conn, &scope, crate::now_seconds(), |p| {
                    let _ = app.emit(EXPORT_PROGRESS, &p);
                })?;
                let count = document.tracks.len() as u32;
                std::fs::write(&path, export::to_json(&document)?)
                    .map_err(|e| crate::error::AppError::io(&path, e))?;
                Ok(count)
            },
            |count| Fields::new().add("tracks", count),
        )
    })
    .await
}

/// Opens the OS file manager with one track selected.
///
/// Takes a track id rather than a path so the frontend never has to hold a
/// path it might act on; the row it has is enough.
#[tauri::command]
pub fn reveal_track(log: State<'_, Log>, db: State<'_, Db>, track_id: i64) -> AppResult<()> {
    log.op("reveal.track")
        .add("track", track_id)
        .quiet()
        .run(|| {
            let conn = db.conn()?;
            let track = playback::tracks_by_ids(&conn, &[track_id])?
                .into_iter()
                .next()
                .ok_or_else(|| {
                    crate::error::AppError::NotFound("That song is not in the library.".into())
                })?;
            crate::reveal::reveal(std::path::Path::new(&track.path))
        })
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

/// Minutes between unattended library passes; zero means off.
///
/// A number rather than the opaque strings above, because Rust is what reads
/// it: the `library-watch` thread asks for it on every wake.
#[tauri::command]
pub fn load_watch_interval(db: State<'_, Db>) -> AppResult<u32> {
    let conn = db.conn()?;
    settings::watch_interval(&conn)
}

#[tauri::command]
pub fn save_watch_interval(db: State<'_, Db>, minutes: u32) -> AppResult<()> {
    let conn = db.conn()?;
    settings::set(&conn, settings::WATCH_INTERVAL, &minutes.to_string())
}

/// Which sidebar sections are collapsed, as the frontend wrote them.
///
/// Opaque here, like the column layout and for the same reason: which sections
/// exist is decided in the sidebar, and a second definition of that in Rust
/// would be one more thing to keep in step. Deliberately not exportable - it
/// describes how this machine's window is arranged, not the library.
#[tauri::command]
pub fn load_sidebar_sections(db: State<'_, Db>) -> AppResult<Option<String>> {
    let conn = db.conn()?;
    settings::get(&conn, settings::SIDEBAR)
}

#[tauri::command]
pub fn save_sidebar_sections(db: State<'_, Db>, sections_json: String) -> AppResult<()> {
    let conn = db.conn()?;
    settings::set(&conn, settings::SIDEBAR, &sections_json)
}

/// Whether the cover-coloured background is on.
///
/// A bool rather than the opaque string the sidebar and column layouts use:
/// there is one thing to say here, and Rust has to read it anyway for the
/// export allowlist to mean anything.
#[tauri::command]
pub fn load_dynamic_background(db: State<'_, Db>) -> AppResult<bool> {
    let conn = db.conn()?;
    settings::dynamic_background(&conn)
}

#[tauri::command]
pub fn save_dynamic_background(db: State<'_, Db>, enabled: bool) -> AppResult<()> {
    let conn = db.conn()?;
    settings::set(
        &conn,
        settings::DYNAMIC_BACKGROUND,
        if enabled { "true" } else { "false" },
    )
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

/// Mutes or unmutes, and remembers which for the next launch.
///
/// The level is not touched: `player.volume` still holds what unmuting comes
/// back to, which is the whole reason mute is its own flag rather than a
/// volume of zero.
#[tauri::command]
pub fn player_set_muted(
    db: State<'_, Db>,
    player: State<'_, Player>,
    muted: bool,
) -> AppResult<()> {
    player.send(Command::SetMuted(muted))?;
    let conn = db.conn()?;
    settings::set(&conn, settings::MUTED, if muted { "true" } else { "false" })
}

/// Turns repeat-one on or off.
///
/// Not persisted, unlike mute and volume. A player that came back from a
/// restart still looping one song would be a surprise, and repeat is a thing
/// done to the song playing now rather than a preference about the app.
#[tauri::command]
pub fn player_set_repeat_one(player: State<'_, Player>, repeat: bool) -> AppResult<()> {
    player.send(Command::SetRepeatOne(repeat))
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
        invalidate::announce(&app);
        Ok(seeded)
    })
    .await
    .map_err(|e| crate::error::AppError::Internal(format!("seed task failed: {e}")))?;

    seeded
}

/// What the Settings pane and the Account menu show.
///
/// Answered from the database alone: whether an account is connected is a
/// stored fact, and asking last.fm on every launch would make a local player
/// talk to a server before the user has done anything.
#[tauri::command]
pub fn lastfm_status(log: State<'_, Log>, db: State<'_, Db>) -> AppResult<LastfmStatus> {
    log.op("lastfm.status").quiet().run(|| {
        let conn = db.conn()?;
        Ok(LastfmStatus {
            configured: lastfm::credentials().is_some(),
            username: lastfm::auth::stored_session(&conn)?.map(|session| session.username),
            queued: lastfm::queue::depth(&conn)?,
        })
    })
}

/// The transport and credentials, or a message saying which is missing.
///
/// A build compiled without an API key is the ordinary case for every local
/// build and every CI run, and the message has to say so rather than reading
/// like a network failure.
fn lastfm_ready() -> AppResult<(
    &'static lastfm::transport::HttpTransport,
    lastfm::Credentials,
)> {
    let credentials = lastfm::credentials().ok_or_else(|| {
        crate::error::AppError::Internal("This build carries no last.fm API key.".to_owned())
    })?;
    let transport = lastfm::transport::shared().ok_or_else(|| {
        crate::error::AppError::Internal("This machine has no usable HTTP client.".to_owned())
    })?;
    Ok((transport, credentials))
}

/// Step one of connecting: a token, and where to send the user with it.
///
/// **The only thing that leaves the machine here is an API key.** The password
/// is typed on last.fm's own page, in the user's own browser, which is why
/// this flow was chosen over the one that would have asked for it in-app.
#[tauri::command]
pub async fn lastfm_begin_connect(app: tauri::AppHandle) -> AppResult<LastfmConnection> {
    let op = op(&app, "lastfm.begin_connect");

    blocking("last.fm connect", move || {
        op.run(|| {
            let (transport, credentials) = lastfm_ready()?;
            let token = lastfm::auth::request_token(transport, &credentials)?;
            Ok(LastfmConnection {
                authorize_url: lastfm::auth::authorize_url(credentials.api_key, &token),
                token,
            })
        })
    })
    .await
}

/// Step three: one attempt at exchanging the token for a session key.
///
/// `None` means the user has not finished in the browser yet, so ask again -
/// the cadence is the frontend's, because nothing in Rust should sleep and the
/// timing is testable there against a mocked `ipc`.
#[tauri::command]
pub async fn lastfm_complete_connect(
    app: tauri::AppHandle,
    token: String,
) -> AppResult<Option<String>> {
    let op = op(&app, "lastfm.connect");

    blocking("last.fm connect", move || {
        let outcome = (|| {
            let (transport, credentials) = lastfm_ready()?;
            match lastfm::auth::poll_session(transport, &credentials, &token)? {
                lastfm::auth::Poll::NotYet => Ok(None),
                lastfm::auth::Poll::Authorized(session) => {
                    let conn = app.state::<Db>().conn()?;
                    lastfm::auth::store_session(&conn, &session)?;
                    Ok(Some(session.username))
                }
            }
        })();

        match &outcome {
            // The frontend polls this until the user has finished in the
            // browser. A line per poll would bury the one that says an account
            // actually arrived.
            Ok(None) => {}
            Ok(Some(username)) => op.succeeded(Fields::new().add("user", username)),
            Err(error) => op.failed(error),
        }
        outcome
    })
    .await
}

/// Forgets the account.
///
/// Local only, and deliberately: last.fm has no method to revoke a session key,
/// so the honest thing is to stop using it and say where the user can revoke it
/// properly. Nothing is sent.
#[tauri::command]
pub fn lastfm_disconnect(log: State<'_, Log>, db: State<'_, Db>) -> AppResult<()> {
    log.op("lastfm.disconnect").run(|| {
        let conn = db.conn()?;
        lastfm::auth::forget_session(&conn)
    })
}

/// The panic the previous run wrote down, if the user has not seen it yet.
///
/// Filtered here rather than in the frontend so that "already dismissed" is
/// one fact in one place: the notice is shown once per crash, not at every
/// launch after one.
#[tauri::command]
pub fn last_crash(log: State<'_, Log>, db: State<'_, Db>) -> AppResult<Option<CrashReport>> {
    log.op("crash.last").quiet().run(|| last_crash_report(&db))
}

/// Split out so the command above is its log wrapper and nothing else.
fn last_crash_report(db: &Db) -> AppResult<Option<CrashReport>> {
    let path = crash::log_path(crash_dir(db));
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

/// Panics on a spawned thread, on purpose. **Test-only.**
///
/// The e2e suite needs a crash report to exist so it can photograph the notice
/// that reports one, and the honest way to produce one is to actually crash.
/// A hand-written log file would be testing the file format against itself:
/// this goes through the real hook, the real formatter and the real writer,
/// which is the whole path the feature consists of.
///
/// On a *spawned* thread, so the process survives it. That is also the case
/// the feature exists for - a panic on the player thread or in the scan pool
/// is the one nothing else would ever report.
///
/// Refused in any build a user could install; see `e2e_only`.
#[tauri::command]
pub fn e2e_provoke_panic() -> AppResult<()> {
    crate::e2e_only("e2e_provoke_panic")?;

    // Joined, so the command does not return before the hook has finished
    // writing - otherwise the next thing the test does is read a file that is
    // not there yet.
    std::thread::Builder::new()
        .name("e2e-provoked".to_owned())
        .spawn(|| panic!("a deliberate panic, provoked by the end-to-end suite"))
        .map_err(|e| crate::error::AppError::Internal(format!("spawn failed: {e}")))?
        .join()
        .expect_err("the thread was supposed to panic");

    Ok(())
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

/// Opens the file manager with `main.log` selected.
///
/// Beside `reveal_crash_log`, and for the same reason it reveals rather than
/// renders: the file is megabytes of lines meant to be read in an editor or
/// sent to somebody, not paged through in a dialog. A log nobody can find is
/// not one.
#[tauri::command]
pub fn reveal_main_log(log: State<'_, Log>) -> AppResult<()> {
    crate::reveal::reveal(log.path())
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

    /// The whole point of `blocking`, in the only terms a test can check
    /// without a window: the work does not happen on the thread that asked for
    /// it. A command that lost its `spawn_blocking` would do its file I/O
    /// inline here, on the caller - which in the app is the thread the IPC
    /// runs on, and is why a 500-file write used to hold the window still.
    #[test]
    fn a_long_write_runs_off_the_thread_that_asked_for_it() {
        // A thread-local rather than a thread id: it is false on every thread
        // but the one that set it, whereas a thread id is only as unique as
        // the ids of dead threads are unrecycled.
        thread_local! {
            static IS_CALLER: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
        }
        IS_CALLER.with(|caller| caller.set(true));

        let ran_on_the_caller = tauri::async_runtime::block_on(blocking("test", || {
            Ok(IS_CALLER.with(std::cell::Cell::get))
        }))
        .unwrap();

        assert!(
            !ran_on_the_caller,
            "the work ran on the thread that asked for it - `spawn_blocking` is gone"
        );
    }

    #[test]
    fn a_staged_cover_is_named_for_what_its_bytes_are() {
        let dir = std::path::Path::new(r"C:\cache");

        // The extension follows the sniff, not the chosen file's name, which
        // is all `File.type` would have given us.
        assert_eq!(
            staged_cover_path(dir, "image/png"),
            dir.join("chosen-cover.png")
        );
        assert_eq!(
            staged_cover_path(dir, "image/jpeg"),
            dir.join("chosen-cover.jpg")
        );
    }

    #[test]
    fn staging_leaves_exactly_one_file_behind() {
        let dir = tempfile::tempdir().unwrap();

        let png = stage_cover(dir.path(), &[0x89, b'P', b'N', b'G', 1, 2, 3]).unwrap();
        assert!(std::path::Path::new(&png).exists());

        // A second choice in the other format. Both land on the fixed stem, so
        // without the sweep the cache would hold the last PNG *and* the last
        // JPEG - and `staged_cover` would have two files to pick between.
        let jpg = stage_cover(dir.path(), &[0xFF, 0xD8, 0xFF, 9]).unwrap();
        assert!(std::path::Path::new(&jpg).exists());
        assert!(!std::path::Path::new(&png).exists());

        // And a refusal leaves what was staged alone rather than clearing it.
        assert!(stage_cover(dir.path(), b"not an image").is_err());
        assert!(std::path::Path::new(&jpg).exists());
    }

    #[test]
    fn reports_the_crate_name_and_a_semver_version() {
        let info = app_info();
        assert_eq!(info.name, "apex");
        assert_eq!(info.version.split('.').count(), 3);
    }
}
