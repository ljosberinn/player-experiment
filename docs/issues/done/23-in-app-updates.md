# 23 — In-app updates

Merged in #23, fixed in #34.

Both original blockers are gone: the repository is public, so release assets are
fetchable without embedding a credential in a shipped binary, and the minisign
keypair exists, is backed up outside this repo, and has been verified end to end.
Minisign is the updater's own signing, unrelated to the Authenticode signing
ruled out at the start. **Losing that private key means no existing install can
ever update again.**

**The defect this phase existed to fix.** The launch check called the plugin's
`downloadAndInstall`, whose second half is not a download: on Windows
`Update::install` hands the installer to `ShellExecute` and then calls
`std::process::exit(0)`. So the shipped behaviour was the app disappearing
mid-song, taking the queue with it, with no prompt. The `relaunch()` in the
store was dead code — the process was already gone. The tests mocked
`downloadAndInstall` as a resolving promise, which is the one thing it never
does.

Fixed by calling `download()` and `install()` separately, holding the `Update`
handle in the store between them, and letting only a button press reach
`install`.

**Apply-on-quit is not achievable on Windows** — a finding, not a shortcut. Both
install modes that suppress the installer UI hard-code `/R` (restart afterwards),
and `installer_args` only appends, so it cannot be taken back off. The only mode
without it shows the installer window instead. An apply-on-quit built on this
reopens the app you just closed.

**Shipped behaviour:** check quietly on launch and every six hours, download in
the background, then say so in the footer — *"0.3.0 ready — restart to install"* —
and install only on the click. A check that finds nothing, or fails offline, is
not news and shows nothing.

Two consequences: the download lives behind the Rust handle, so quitting without
clicking discards it; and `@tauri-apps/plugin-process` came out along with
`process:allow-restart`, since nothing relaunches anything any more — a granted
permission with no caller is what the capability guard exists to prevent.

The test that matters asserts a negative: a check never calls `install`. The
install itself cannot be tested anywhere — it replaces the running binary.
