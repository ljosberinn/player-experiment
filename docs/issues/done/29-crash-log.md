# 29 — Local crash log, and screenshots in the PR body

Merged in #46. What phase 11 was cut for, at a fraction of the cost.

A panic on the audio thread, in the `rayon` scan pool, or inside `symphonia` on a
malformed mp3 takes the window with it and no JS handler runs.
`std::panic::set_hook` covers that with no network, no DSN, no opt-in toggle to
design and nothing to scrub.

- `crash.rs` holds the hook, the format, and a bounded log of the last five
  reports beside the database. The hook **chains** the previous one, so a debug
  build still prints to stderr.
- Three commands: `last_crash` (returns nothing for a crash already dismissed —
  the notice belongs to the crash, not to the session), `acknowledge_crash`,
  `reveal_crash_log`.
- Asked for once on mount: a crash that already happened cannot happen again
  while the app is up.
- Two of its three failure paths are deliberately silent — a log that cannot be
  read and a dismissal that cannot be recorded are both worse as a banner. The
  third, "show me the file" failing, is reported: the user asked for something.
- **An `AlertDialog`, not a banner.** The banner sat where the scan and tag
  notices sit, which describe the session that is *running*, and it could be
  scrolled past. A backdrop click cannot dismiss an `AlertDialog`, so the choice
  has to be made. Escape counts as having seen it.
- Not styled red: by the time it is on screen the app is running fine. Only the
  panic message is in `--danger`.
- A `PanicHookInfo` cannot be constructed outside a real panic, so the formatter
  takes what the hook knows as parameters and the hook formats nothing — which is
  what makes both testable.

**Screenshots in the pull request body.** Phase 27 rejected screenshots as
*assertions*, and that stands; but a PR that changes what the app looks like had
been describing the change in prose. So the e2e suite now *takes* pictures without
*comparing* them — nothing compared, nothing to flake — and never commits them (a
first attempt did, under `docs/screenshots/`, and was reverted: a picture in the
tree has to be maintained forever).

Making them visible was the hard part. A markdown body can only embed an image it
can fetch by URL, an artifact is a zip behind an authenticated download, and the
drag-into-the-comment-box upload needs a web session no REST call replaces. So CI
pushes them to `ci/screenshots`, a disposable branch that exists only to hold
them, and rewrites the PR body between markers to point at raw URLs pinned to that
commit.

The crash notice was the first subject, because it is the one feature no unit test
can reach end to end: the spec provokes a **real panic** through a test-only
command on a spawned thread, then reloads the webview.
