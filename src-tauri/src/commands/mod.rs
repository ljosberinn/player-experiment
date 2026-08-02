//! The IPC surface.
//!
//! Command bodies stay thin on purpose: they parse arguments and delegate to a
//! domain module, so the domain stays unit-testable without a Tauri runtime.

use crate::error::AppResult;
use crate::model::AppInfo;

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
