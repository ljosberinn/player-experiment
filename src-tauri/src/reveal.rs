//! "Show in Explorer" - open the OS file manager with a track selected.
//!
//! This is deliberately a command of our own rather than
//! `tauri-plugin-opener`. The plugin would do the same job, but every Tauri
//! plugin API is gated behind the capability file, and a missing permission
//! there fails only at runtime - twice now that has shipped a dead feature.
//! Our own commands are not ACL-gated, so this route has no such trap.
//!
//! The argv construction is pure and tested per platform; the spawn itself is
//! not, because asserting that Explorer opened is not something a test can do.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// What to run to reveal `path`, as (program, args).
///
/// Split out from [`reveal`] so the platform quirks below are testable without
/// launching a file manager on the machine running the tests.
fn argv(path: &Path) -> (&'static str, Vec<String>) {
    let display = path.to_string_lossy().into_owned();

    #[cfg(target_os = "windows")]
    {
        // `/select,` and the path are **one argument**, not two: Explorer
        // parses its own command line and treats a separated path as a folder
        // to open rather than an item to highlight. Passing them apart opens
        // the parent with nothing selected, which looks like it half-worked.
        ("explorer.exe", vec![format!("/select,{display}")])
    }

    #[cfg(target_os = "macos")]
    {
        ("open", vec!["-R".to_owned(), display])
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        // No portable "select this file" on Linux - the freedesktop
        // FileManager1 D-Bus interface is not universally implemented. Opening
        // the containing folder is the honest fallback.
        let parent = path
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or(display);
        ("xdg-open", vec![parent])
    }
}

/// Opens the file manager with `path` selected.
///
/// A missing file is refused rather than opening an empty folder: by the time
/// someone reaches for this, "where is it?" and "it is gone" are different
/// answers and only one of them is worth acting on.
pub fn reveal(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Err(AppError::NotFound(format!(
            "{} is no longer on disk.",
            PathBuf::from(path).display()
        )));
    }

    let (program, args) = argv(path);
    std::process::Command::new(program)
        .args(args)
        .spawn()
        .map_err(|cause| AppError::Internal(format!("Could not open the file manager: {cause}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_a_path_that_is_not_there() {
        let error = reveal(Path::new("Z:/nowhere/at/all.mp3")).unwrap_err();

        assert!(matches!(error, AppError::NotFound(_)));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_passes_the_switch_and_path_as_one_argument() {
        let (program, args) = argv(Path::new(r"C:\Music\01 Maki.mp3"));

        assert_eq!(program, "explorer.exe");
        // Two arguments here would open the folder without selecting anything.
        assert_eq!(args, vec![r"/select,C:\Music\01 Maki.mp3".to_owned()]);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_keeps_spaces_without_quoting_them() {
        let (_, args) = argv(Path::new(r"C:\My Music\a b.mp3"));

        // `Command` passes each argument through as-is; adding quotes here
        // would put literal quote characters into the path Explorer sees.
        assert_eq!(args, vec![r"/select,C:\My Music\a b.mp3".to_owned()]);
        assert!(!args[0].contains('"'));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_reveals_rather_than_opens() {
        let (program, args) = argv(Path::new("/Music/01 Maki.mp3"));

        // `open` without -R would *play* the file, which is not the ask.
        assert_eq!(program, "open");
        assert_eq!(args, vec!["-R".to_owned(), "/Music/01 Maki.mp3".to_owned()]);
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    #[test]
    fn elsewhere_falls_back_to_the_containing_folder() {
        let (program, args) = argv(Path::new("/music/01 Maki.mp3"));

        assert_eq!(program, "xdg-open");
        assert_eq!(args, vec!["/music".to_owned()]);
    }
}
