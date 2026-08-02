pub mod audio;
pub mod commands;
pub mod db;
pub mod error;
pub mod export;
pub mod model;
pub mod reveal;
pub mod scan;
pub mod smart;
pub mod tags;

use tauri::{Emitter, Manager};

use crate::audio::{Event, Player, RodioSink};
use crate::db::{playback, settings, Db};

/// Where the library lives on disk, under the OS app-data directory.
fn database_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, tauri::Error> {
    Ok(app.path().app_data_dir()?.join("library.sqlite3"))
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
        .setup(|app| {
            let path = database_path(app.handle())?;
            let db = Db::open(&path)?;
            let volume = db.conn().and_then(|conn| settings::volume(&conn))?;
            app.manage(start_player(app.handle().clone(), db.clone(), volume));
            app.manage(db);
            Ok(())
        })
        // Cover art is served over its own protocol rather than embedded in
        // track rows: the bytes stay out of every page payload and the webview
        // gets to cache them per hash.
        .register_asynchronous_uri_scheme_protocol("cover", |ctx, request, responder| {
            let hash = request.uri().path().trim_start_matches('/').to_owned();
            let db = ctx.app_handle().state::<Db>().inner().clone();

            tauri::async_runtime::spawn_blocking(move || {
                let found = db.conn().ok().and_then(|conn| query_cover(&conn, &hash));
                let response = match found {
                    Some((mime, bytes)) => tauri::http::Response::builder()
                        .header("Content-Type", mime)
                        .header("Cache-Control", "max-age=31536000, immutable")
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
            commands::scan_library,
            commands::query_tracks,
            commands::count_tracks,
            commands::all_track_ids,
            commands::list_playlists,
            commands::create_playlist,
            commands::create_smart_playlist,
            commands::set_playlist_filter,
            commands::playlist_filter,
            commands::rename_playlist,
            commands::delete_playlist,
            commands::add_to_playlist,
            commands::remove_from_playlist,
            commands::move_in_playlist,
            commands::library_stats,
            commands::export_library,
            commands::reveal_track,
            commands::save_window_geometry,
            commands::load_window_geometry,
            commands::tracks_by_ids,
            commands::write_tags,
            commands::undo_tag_edit,
            commands::can_undo_tag_edit,
            commands::player_play,
            commands::player_toggle,
            commands::player_pause,
            commands::player_resume,
            commands::player_stop,
            commands::player_next,
            commands::player_previous,
            commands::player_seek,
            commands::player_set_volume,
            commands::player_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Starts the player thread and forwards its events to the webview.
///
/// The sink is opened here so a machine with no audio device still gets a
/// running app: playback commands then fail loudly instead of the window
/// refusing to open. CI runners are exactly that machine.
fn start_player(app: tauri::AppHandle, db: Db, volume: f32) -> Player {
    let sink = match RodioSink::open() {
        Ok(sink) => sink,
        Err(message) => {
            let _ = app.emit("player://error", &message);
            return Player::spawn(audio::sink::NullSink::new(message), volume, |_, _| {});
        }
    };

    Player::spawn(sink, volume, move |event, state| match event {
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
        Event::Played(track_id) => {
            // A lost play count is not worth interrupting playback for.
            if let Ok(conn) = db.conn() {
                let _ = playback::mark_played(&conn, *track_id, now_seconds());
            }
        }
        Event::Error(message) => {
            let _ = app.emit("player://error", message);
        }
    })
}

pub(crate) fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

fn query_cover(conn: &rusqlite::Connection, hash: &str) -> Option<(String, Vec<u8>)> {
    crate::db::query::cover_bytes(conn, hash).ok().flatten()
}
