# 189 — One instance per library

A second `apex.exe` starts its own player, scrobbler and library worker against
the same `library.sqlite3`, and the two compete for the media keys. A second
launch should bring the running window to the front and exit.

Not `tauri-plugin-single-instance`: its Windows implementation is `unsafe`
(`CreateMutexW`, a window proc). This is std only.

## Shape

- `instance.rs`. `acquire(dir)` creates `dir`, opens `instance.lock` in it and
  calls `File::try_lock`. It returns the held `Instance`, managed for the app's
  lifetime, or `None` if the lock is held. The OS releases it when the process
  dies.
- `Instance::listen` binds `127.0.0.1:0`, writes the port to `instance.port`,
  and runs a thread that calls back per connection. The port has its own file
  because the locked one cannot be read from another handle.
- The callback unminimizes and focuses `main`, but only once it is visible:
  before the frontend has shown it, showing it would skip the geometry restore.
- If the lock is held, `hand_off` reads `instance.port` and connects with a
  500 ms timeout; setup then calls `std::process::exit(0)` either way.
- In `setup`, after the log handle and before `Db::open`. A lock that errors is
  logged and the app starts anyway.

e2e runs use their own data directory, so their own lock. `tauri dev` shares the
installed app's identifier and exits while it runs.

## Verification

- With Apex running, launch it again from the Start menu. The existing window
  comes to the front, and Task Manager shows one `apex.exe`.
- The same with the window minimised. It is restored.
- Windows restricts `SetForegroundWindow` from a background process. Check
  whether the window takes focus or only flashes in the taskbar.
- No firewall prompt on first launch.
- Kill Apex from Task Manager, then launch. It starts normally.
- Update through the in-app updater. The relaunched app is not refused by the
  exiting one.
