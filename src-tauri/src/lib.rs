pub mod commands;
pub mod error;
pub mod model;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Only present in e2e builds (`--features wdio`); see Cargo.toml.
    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .invoke_handler(tauri::generate_handler![commands::get_app_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
