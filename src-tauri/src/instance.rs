//! One running app per library.
//!
//! Two processes on one `library.sqlite3` would each run a player, a scrobbler
//! and a library worker against it, and fight over the media keys. The first
//! holds a lock beside the database; a later launch finds it held, asks the
//! holder to come forward and exits.
//!
//! Std only, rather than `tauri-plugin-single-instance`, whose Windows half is
//! `unsafe` (`CreateMutexW` and a window proc of its own).

use std::fs::{File, OpenOptions, TryLockError};
use std::io;
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

const LOCK: &str = "instance.lock";

/// Where the holder is listening. A file of its own because Windows locks are
/// mandatory: no other handle can read the locked one.
const PORT: &str = "instance.port";

/// Long enough for a loopback connect to a busy process, short enough that a
/// second launch never looks hung.
const HANDOFF_TIMEOUT: Duration = Duration::from_millis(500);

/// The lock, held until the process ends. The OS releases it then, so a crash
/// leaves nothing stale behind.
pub struct Instance {
    dir: PathBuf,
    _lock: File,
}

/// Takes the lock for `dir`, or answers `None` if another process holds it.
pub fn acquire(dir: &Path) -> io::Result<Option<Instance>> {
    // The first launch on a machine runs before `Db::open` has made the folder.
    std::fs::create_dir_all(dir)?;
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(dir.join(LOCK))?;
    match file.try_lock() {
        Ok(()) => Ok(Some(Instance {
            dir: dir.to_path_buf(),
            _lock: file,
        })),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(error)) => Err(error),
    }
}

impl Instance {
    /// Calls `raise` for every later launch that hands off to this one.
    ///
    /// Loopback only, which is also what keeps the first launch free of a
    /// firewall prompt.
    pub fn listen(&self, raise: impl Fn() + Send + 'static) -> io::Result<()> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        std::fs::write(
            self.dir.join(PORT),
            listener.local_addr()?.port().to_string(),
        )?;
        std::thread::Builder::new()
            .name("instance-listen".to_owned())
            .spawn(move || {
                // The connection is the whole message; nothing is read from it.
                for stream in listener.incoming() {
                    if stream.is_ok() {
                        raise();
                    }
                }
            })?;
        Ok(())
    }
}

/// Asks the process holding `dir`'s lock to come forward.
///
/// An error is for the caller to ignore: a port file written by a holder that
/// has since died, or read half-written by one just starting, only means the
/// window is not raised.
pub fn hand_off(dir: &Path) -> io::Result<()> {
    let port: u16 = std::fs::read_to_string(dir.join(PORT))?
        .trim()
        .parse()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    TcpStream::connect_timeout(
        &SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        HANDOFF_TIMEOUT,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn a_held_lock_is_refused_until_it_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let first = acquire(dir.path()).unwrap();
        assert!(first.is_some());
        assert!(acquire(dir.path()).unwrap().is_none());

        drop(first);
        assert!(acquire(dir.path()).unwrap().is_some());
    }

    #[test]
    fn the_first_launch_makes_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("not").join("yet");
        assert!(acquire(&nested).unwrap().is_some());
    }

    #[test]
    fn a_handoff_reaches_the_holder() {
        let dir = tempfile::tempdir().unwrap();
        let held = acquire(dir.path()).unwrap().unwrap();
        let (raised, heard) = mpsc::channel();
        held.listen(move || {
            let _ = raised.send(());
        })
        .unwrap();

        hand_off(dir.path()).unwrap();
        heard.recv_timeout(Duration::from_secs(5)).unwrap();
    }

    #[test]
    fn a_missing_port_file_fails_quietly() {
        let dir = tempfile::tempdir().unwrap();
        assert!(hand_off(dir.path()).is_err());
    }

    #[test]
    fn a_port_nobody_listens_on_fails_quietly() {
        let dir = tempfile::tempdir().unwrap();
        let gone = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = gone.local_addr().unwrap().port();
        drop(gone);
        std::fs::write(dir.path().join(PORT), port.to_string()).unwrap();

        assert!(hand_off(dir.path()).is_err());
    }
}
