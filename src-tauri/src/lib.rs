pub mod commands;
pub mod db;
pub mod error;
pub mod model;
pub mod scan;
pub mod tags;

use tauri::Manager;

use crate::db::Db;

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
        .setup(|app| {
            let path = database_path(app.handle())?;
            let db = Db::open(&path)?;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn query_cover(conn: &rusqlite::Connection, hash: &str) -> Option<(String, Vec<u8>)> {
    crate::db::query::cover_bytes(conn, hash).ok().flatten()
}
