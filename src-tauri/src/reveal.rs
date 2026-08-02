//! "Show in Explorer" - open the OS file manager with a track selected.
//!
//! This is deliberately a command of our own rather than
//! `tauri-plugin-opener`. The plugin would do the same job, but every Tauri
//! plugin API is gated behind the capability file, and a missing permission
//! there fails only at runtime - twice now that has shipped a dead feature.
//! Our own commands are not ACL-gated, so this route has no such trap.
//!
//! The command line is built by pure functions and tested; the spawn itself is
//! not, because asserting that Explorer opened is not something a test can do.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// The **raw** command line for `explorer.exe`, quotes and all.
///
/// Explorer parses its own command line rather than taking argv, and it is
/// fussy in two ways that fight each other:
///
/// 1. `/select,` and the path must arrive as **one** token. Split apart,
///    Explorer opens the parent folder with nothing highlighted.
/// 2. A path containing a space must be **quoted**, or Explorer stops reading
///    at the space.
///
/// Rust's `Command::arg` escapes for the *standard* C runtime rules, which
/// wrap an argument containing a space in quotes as a whole -
/// `"/select,C:\My Music\a.mp3"`. Explorer cannot parse that, and its response
/// to a command line it cannot parse is to open the Documents folder, which is
/// exactly the bug this fixes. So on Windows the line is built here and passed
/// through `raw_arg` unescaped.
#[cfg(target_os = "windows")]
pub(crate) fn windows_command_line(path: &Path) -> String {
    // Only the path is quoted, never the switch: the quotes have to be inside
    // the single token, not around it.
    format!("/select,\"{}\"", path.to_string_lossy())
}

/// What to run to reveal `path` on the platforms whose file managers take a
/// normal argv.
#[cfg(not(target_os = "windows"))]
pub(crate) fn argv(path: &Path) -> (&'static str, Vec<String>) {
    let display = path.to_string_lossy().into_owned();

    #[cfg(target_os = "macos")]
    {
        // `open` without -R would *play* the file, which is not the ask.
        ("open", vec!["-R".to_owned(), display])
    }

    #[cfg(not(target_os = "macos"))]
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

    #[cfg(target_os = "windows")]
    let spawned = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .raw_arg(windows_command_line(path))
            .spawn()
    };

    #[cfg(not(target_os = "windows"))]
    let spawned = {
        let (program, args) = argv(path);
        std::process::Command::new(program).args(args).spawn()
    };

    spawned
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
    mod windows {
        use super::*;

        #[test]
        fn keeps_the_switch_and_path_in_one_token() {
            let line = windows_command_line(Path::new(r"C:\Music\Maki.mp3"));

            // Split apart, Explorer opens the parent with nothing highlighted.
            assert_eq!(line, "/select,\"C:\\Music\\Maki.mp3\"");
            assert!(!line.contains("/select, "));
        }

        #[test]
        fn quotes_a_path_containing_spaces() {
            let line = windows_command_line(Path::new(r"C:\My Music\a b.mp3"));

            // This is the case that was broken: an earlier version passed the
            // token through `Command::arg`, which quoted the *whole* thing as
            // `"/select,C:\My Music\a b.mp3"`. Explorer cannot parse that, and
            // answers an unparseable command line by opening Documents.
            assert_eq!(line, "/select,\"C:\\My Music\\a b.mp3\"");
            assert!(line.starts_with("/select,\""));
            assert!(line.ends_with('"'));
        }

        #[test]
        fn quotes_wrap_only_the_path() {
            let line = windows_command_line(Path::new(r"C:\Music\Maki.mp3"));

            // Exactly two quotes, both around the path. A quote before the
            // switch is the failure mode being guarded against.
            assert_eq!(line.matches('"').count(), 2);
            assert!(!line.starts_with('"'));
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_reveals_rather_than_opens() {
        let (program, args) = argv(Path::new("/Music/01 Maki.mp3"));

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
