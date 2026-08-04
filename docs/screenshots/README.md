# Screenshots

Committed on purpose, and worth explaining because it looks like the thing
phase 27 rejected.

What phase 27 rejected was pixel **baselines**: images something *compares*
against, which flake on antialiasing, differ between a developer machine and
Windows Server, and have to be regenerated whenever anything moves. Nothing
compares these. They exist so a pull request that changes what the app looks
like can show it, in the body, where a reviewer will actually see it.

They are here rather than in the build artifact because a GitHub pull request
body can only embed an image it can fetch by URL, and the artifact is a zip
behind an authenticated download. Dragging an image into the web editor uploads
it to GitHub's own CDN, which is the normal answer and is not reachable from a
command line.

## Rules, so this stays 300 kB and not 300 MB

- **Overwrite, never accumulate.** One file per state per theme, replaced when
  it changes. No `-v2`, no dates, no one-per-run.
- **Only what a reviewer needs to see.** A feature whose appearance is not the
  point does not get a photograph.
- **Delete when the feature goes.** These are documentation of the current
  build, not a history of it - the git history holds that already.

Fresh copies of every capture the suite takes are on each e2e run as the
`e2e-screenshots` artifact, with seven-day retention. `e2e/screenshot.ts` is
what takes them.
