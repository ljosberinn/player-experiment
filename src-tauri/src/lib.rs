pub mod audio;
pub mod commands;
pub mod crash;
pub mod db;
pub mod error;
pub mod export;
pub mod lastfm;
pub mod log;
pub mod model;
pub mod palette;
pub mod reveal;
pub mod scan;
pub mod smart;
pub mod tags;
pub mod tagsource;

use tauri::{Emitter, Manager};

use crate::audio::{Event, Player, RodioSink};
use crate::db::{playback, settings, Db};

/// The environment this build reads, which exists only in the e2e build.
///
/// The whole module is behind the `wdio` feature, so a shipped binary cannot
/// be pointed at another library or handed a fake audio device by setting a
/// variable - the code that would read them is not in it.
#[cfg(feature = "wdio")]
mod e2e {
    /// Directory the library database lives in, replacing the OS app-data one.
    /// Gives each spec file its own library, so a spec that seeds one does not
    /// leave rows behind for the spec that asserts on an empty one.
    pub const DATA_DIR: &str = "PLAYER_E2E_DATA_DIR";

    /// Selects a sink that accepts every load and plays silence. A CI runner
    /// has no audio device, so without it nothing downstream of a successful
    /// load is reachable.
    pub const SILENT_AUDIO: &str = "PLAYER_E2E_SILENT_AUDIO";

    /// The value of one of them, if it is set to anything.
    ///
    /// Non-empty is what counts as set: an empty value is what a shell leaves
    /// behind when it means "unset", and treating that as a path would put the
    /// library at the filesystem root.
    pub fn var(name: &str) -> Option<std::ffi::OsString> {
        std::env::var_os(name).filter(|value| !value.is_empty())
    }
}

/// Refuses unless this is an e2e build that the harness launched.
///
/// The gate on `commands::seed_synthetic_tracks`, which writes a hundred and
/// fifty thousand rows into the library. In a shipped binary this function is
/// the whole of it - the code that could say yes is not compiled in - so the
/// command exists there only to answer that it will not.
pub(crate) fn e2e_only(what: &str) -> crate::error::AppResult<()> {
    #[cfg(feature = "wdio")]
    if e2e::var(e2e::DATA_DIR).is_some() {
        return Ok(());
    }

    Err(crate::error::AppError::Internal(format!(
        "{what} is test-only and this is not a test build"
    )))
}

/// Where the library lives on disk, under the OS app-data directory.
fn database_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, tauri::Error> {
    let default = app.path().app_data_dir()?;
    Ok(data_dir(default).join("library.sqlite3"))
}

/// The app-data directory, or whatever the e2e build was pointed at instead.
fn data_dir(default: std::path::PathBuf) -> std::path::PathBuf {
    #[cfg(feature = "wdio")]
    if let Some(overridden) = e2e::var(e2e::DATA_DIR) {
        return std::path::PathBuf::from(overridden);
    }
    default
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Only present in e2e builds (`--features wdio`); see Cargo.toml.
    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // The only way this app opens anything outside itself. Its permission
        // in capabilities/default.json names the exact URLs it may open rather
        // than granting `opener:default`, so a link added later cannot quietly
        // send a local-only player anywhere new.
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let path = database_path(app.handle())?;
            // Derived the same way `commands::crash_dir` derives it, so the
            // three files this app writes cannot end up in three places.
            let dir = path
                .parent()
                .unwrap_or_else(|| std::path::Path::new("."))
                .to_path_buf();
            // Before anything that could panic is spawned, and before the
            // database is even opened: a panic in `Db::open` is exactly the
            // kind that takes the window with it and leaves nothing behind.
            crash::install(
                crash::log_path(&dir),
                app.package_info().version.to_string(),
            );
            let log = log::Log::to(log::log_path(&dir));
            // Before anything that can announce, so no write has to fall back
            // to an uncoalesced ping.
            app.manage(commands::Invalidations::default());

            // The first line of every session, and the one that says which
            // library the rest of them are about.
            let db = log
                .op("db.open")
                .add("path", path.display())
                .run(|| Db::open(&path))?;
            // Here rather than inside `Db::open`: which playlists a new library
            // starts with is a product decision, and the storage layer opening
            // a database should not be the thing that has an opinion about it.
            db.conn()
                .and_then(|conn| db::playlists::seed_built_ins(&conn, now_seconds()))?;
            let (volume, muted) = db
                .conn()
                .and_then(|conn| Ok((settings::volume(&conn)?, settings::muted(&conn)?)))?;
            app.manage(start_player(
                app.handle().clone(),
                db.clone(),
                volume,
                muted,
                log.clone(),
            ));
            normalize_covers(db.clone(), log.clone());
            // One lock for everything that rewrites rows from files on disk,
            // so the unattended pass can tell whether it would be racing a
            // scan or a write the user started.
            let lock = scan::ScanLock::default();
            watch_library(app.handle().clone(), db.clone(), lock.clone(), log.clone());
            app.manage(lock);
            app.manage(db);
            app.manage(log);
            Ok(())
        })
        // Cover art is served over its own protocol rather than embedded in
        // track rows: the bytes stay out of every page payload and the webview
        // gets to cache them per hash.
        .register_asynchronous_uri_scheme_protocol("cover", |ctx, request, responder| {
            // The query string is where the tag editor's cache-buster goes, and
            // is not part of what is being asked for.
            let key = request.uri().path().trim_start_matches('/').to_owned();
            let app = ctx.app_handle().clone();

            tauri::async_runtime::spawn_blocking(move || {
                let staged = key == commands::STAGED_COVER;
                let found = if staged {
                    commands::staged_cover(&app)
                } else {
                    let db = app.state::<Db>();
                    db.conn().ok().and_then(|conn| query_cover(&conn, &key))
                };
                let response = match found {
                    Some((mime, bytes)) => tauri::http::Response::builder()
                        .header("Content-Type", mime)
                        // A hash names its own bytes and can be cached forever.
                        // The staging file's name is fixed and its contents are
                        // whatever was chosen last, so it can be cached never.
                        .header(
                            "Cache-Control",
                            if staged {
                                "no-store"
                            } else {
                                "max-age=31536000, immutable"
                            },
                        )
                        .body(bytes),
                    None => tauri::http::Response::builder()
                        .status(404)
                        .body(Vec::new()),
                };
                if let Ok(response) = response {
                    responder.respond(response);
                }
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::add_watch_folder,
            commands::list_watch_folders,
            commands::remove_watch_folder,
            commands::scan_library,
            commands::remove_missing_tracks,
            commands::remove_tracks,
            commands::forget_removed_tracks,
            commands::query_tracks,
            commands::count_tracks,
            commands::browse_groups,
            commands::all_track_ids,
            commands::list_playlists,
            commands::create_playlist,
            commands::create_smart_playlist,
            commands::set_playlist_filter,
            commands::playlist_filter,
            commands::playlist_order,
            commands::rename_playlist,
            commands::delete_playlist,
            commands::add_to_playlist,
            commands::remove_from_playlist,
            commands::move_in_playlist,
            commands::library_stats,
            commands::export_library,
            commands::reveal_track,
            commands::load_column_config,
            commands::save_column_config,
            commands::load_zoom,
            commands::save_zoom,
            commands::load_watch_interval,
            commands::save_watch_interval,
            commands::load_sidebar_sections,
            commands::save_sidebar_sections,
            commands::load_dynamic_background,
            commands::save_dynamic_background,
            commands::load_unattended_lookup,
            commands::save_unattended_lookup,
            commands::save_window_geometry,
            commands::load_window_geometry,
            commands::tracks_by_ids,
            commands::write_tags,
            commands::stage_dropped_cover,
            commands::stage_picked_cover,
            commands::tagsource_groups,
            commands::tagsource_search,
            commands::tagsource_fetch,
            commands::tagsource_apply,
            commands::suggest_tag_values,
            commands::player_play,
            commands::player_toggle,
            commands::player_pause,
            commands::player_resume,
            commands::player_stop,
            commands::player_next,
            commands::player_previous,
            commands::player_seek,
            commands::player_set_volume,
            commands::player_set_muted,
            commands::player_set_repeat_one,
            commands::player_snapshot,
            commands::seed_synthetic_tracks,
            commands::e2e_provoke_panic,
            commands::lastfm_status,
            commands::lastfm_begin_connect,
            commands::lastfm_complete_connect,
            commands::lastfm_disconnect,
            commands::last_crash,
            commands::acknowledge_crash,
            commands::reveal_crash_log,
            commands::reveal_main_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Starts the timer that keeps the watch folders watched.
///
/// The two channels a scan already speaks, and nothing else: real work shows
/// the same progress bar a Rescan does, and a pass that changed something says
/// so on `library://changed`. A pass that found nothing is silent on both -
/// which is why `scan::watch` calls back rather than emitting for itself.
fn watch_library(app: tauri::AppHandle, db: Db, lock: scan::ScanLock, log: log::Log) {
    let progress = app.clone();
    scan::watch::spawn(
        db,
        lock,
        log,
        move |p| {
            let _ = progress.emit(crate::commands::SCAN_PROGRESS, &p);
        },
        move || {
            crate::commands::announce_library_changed(&app);
        },
    );
}

/// Re-encodes artwork a previous build stored whole, off the setup path.
///
/// A thread rather than a migration: a library's covers are half a minute of
/// CPU to decode, and a migration runs in one transaction before the window is
/// shown. It is silent and needs no ordering against anything - a scan or a
/// tag write meeting it mid-pass waits at most one chunk for the write lock -
/// so the handle is dropped and nothing joins it. A quit part-way through
/// resumes on the next launch.
fn normalize_covers(db: Db, log: log::Log) {
    // Nothing here was asked for, so nothing here reports to the window. A
    // pass that fails leaves the flag unset, and the next launch picks up
    // where it stopped - which is exactly the kind of thing that is invisible
    // without a line in the log.
    let _ = std::thread::Builder::new()
        .name("cover-normalize".to_owned())
        .spawn(move || {
            let op = log.op("covers.normalize");
            match db
                .conn()
                .and_then(|mut conn| db::covers::normalize_stored(&mut conn))
            {
                // Every launch after the one that finished the pass. A line
                // per launch saying there was nothing to do is noise in the
                // file the next investigation has to read.
                Ok(false) => {}
                Ok(true) => op.succeeded(log::Fields::new()),
                Err(error) => op.failed(&error),
            }
        });
}

/// Starts the player thread and forwards its events to the webview.
///
/// The sink is opened here so a machine with no audio device still gets a
/// running app: playback commands then fail loudly instead of the window
/// refusing to open. CI runners are exactly that machine.
fn start_player(app: tauri::AppHandle, db: Db, volume: f32, muted: bool, log: log::Log) -> Player {
    // The e2e build can ask for a sink that succeeds without hardware. On the
    // runner the branch below would take the `NullSink` path, where every load
    // fails - so a test could never reach a playing row, which is exactly the
    // appearance the suite is there to check.
    #[cfg(feature = "wdio")]
    if e2e::var(e2e::SILENT_AUDIO).is_some() {
        return Player::spawn(
            audio::sink::SilentSink::new(),
            volume,
            muted,
            forward(app, db, log),
        );
    }

    match RodioSink::open() {
        Ok(sink) => {
            // Read off the sink before it moves onto the player thread: the
            // watcher needs the same stream-error flag the sink was opened
            // with, and the channel it sends into only exists after `spawn`.
            let faulted = sink.faulted();
            let player = Player::spawn(sink, volume, muted, forward(app, db, log));
            player.watch_output(faulted);
            player
        }
        Err(message) => {
            let _ = app.emit("player://error", &message);
            log.op("audio.open").failed(&message);
            // No forwarding: nothing can load, so there is no state to report.
            Player::spawn(
                audio::sink::NullSink::new(message),
                volume,
                muted,
                |_, _| {},
            )
        }
    }
}

/// What the player thread does with each event it produces.
///
/// Separated from [`start_player`] because more than one sink can be behind it
/// and all of them report the same way.
fn forward(
    app: tauri::AppHandle,
    db: Db,
    log: log::Log,
) -> impl FnMut(&Event, &audio::EngineState) + Send + 'static {
    // Owned by this closure, which lives on the player thread, rather than
    // managed as app state: nothing else has a reason to reach it, and the two
    // events that feed it arrive here. `None` in a build with no last.fm key -
    // no thread, no channel, and nothing on the played path that was not there
    // before.
    let scrobbler = lastfm::Scrobbler::start(db.clone(), log.clone(), {
        let app = app.clone();
        Box::new(move |notice| {
            // Neither of these was asked for, so neither is an error popover.
            // One stops the Account menu claiming an account that no longer
            // works; the other is a count in the settings pane.
            let _ = match notice {
                lastfm::Notice::Disconnected => app.emit("lastfm://disconnected", ()),
                lastfm::Notice::Queued(depth) => app.emit("lastfm://queued", depth),
            };
        })
    });

    move |event, state| match event {
        Event::StateChanged => {
            if let Ok(conn) = db.conn() {
                if let Ok(snapshot) = playback::snapshot(&conn, state) {
                    let _ = app.emit("player://state", &snapshot);
                }
            }
        }
        Event::Position {
            position_ms,
            duration_ms,
        } => {
            let _ = app.emit(
                "player://position",
                &crate::model::PlayerPosition {
                    position_ms: *position_ms,
                    duration_ms: *duration_ms,
                },
            );
        }
        Event::NowPlaying {
            track_id,
            started_at,
        } => {
            if let Some(scrobbler) = &scrobbler {
                scrobbler.now_playing(*track_id, *started_at);
            }
        }
        Event::Played {
            track_id,
            started_at,
        } => {
            // A lost play count is not worth interrupting playback for.
            //
            // Logged, unlike pause, seek or volume: this is the moment the
            // library changes and the scrobbler is handed something to send,
            // which is what makes "my play count is wrong" answerable.
            if let Ok(conn) = db.conn() {
                let _ = log
                    .op("playback.played")
                    .add("track", track_id)
                    .run(|| playback::mark_played(&conn, *track_id, now_seconds()));
            }
            // Handed to a thread of its own rather than sent here: this is the
            // player thread, and it is the one thread in the app that must not
            // wait on a socket.
            if let Some(scrobbler) = &scrobbler {
                scrobbler.played(*track_id, *started_at);
            }
        }
        Event::Error(message) => {
            let _ = app.emit("player://error", message);
        }
        Event::LoadFailed(track_id) => {
            // What the event means, rather than why: the reason the sink gave
            // arrives as the `Event::Error` immediately after this one and
            // goes to the user on `player://error`. Carrying it here would
            // mean holding one event to describe the next.
            log.op("playback.load")
                .add("track", track_id)
                .failed(&"the file would not open");
            // Marked here rather than waiting for the next scan: the file is
            // demonstrably not playable now, and the row's status column is
            // where the user will look for why.
            if let Ok(conn) = db.conn() {
                let _ = scan::mark_missing(&conn, *track_id);
            }
        }
        Event::Loaded(track_id) => {
            log.note("playback.load", log::Fields::new().add("track", track_id));
            // The mirror: a file that opens is a file that is there, so a mark
            // left over from an unplugged drive is stale the moment it plays.
            //
            // The event is emitted on every load and the mark is almost never
            // there, so the view is only told when something actually changed -
            // a refresh per track change would drop every cached page for
            // nothing.
            if let Ok(conn) = db.conn() {
                if scan::clear_missing(&conn, *track_id).unwrap_or(false) {
                    crate::commands::announce_library_changed(&app);
                }
            }
        }
    }
}

pub(crate) fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

fn query_cover(conn: &rusqlite::Connection, hash: &str) -> Option<(String, Vec<u8>)> {
    crate::db::query::cover_bytes(conn, hash).ok().flatten()
}
