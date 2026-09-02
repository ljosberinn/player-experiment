# 32 — The rename to Apex

Merged in #51. First of the Apex design phases, and first because the cost only
grows.

`productName` → **Apex**, identifier → `dev.ljosberinn.apex`, plus the window
title, `package.json` name, the README, `index.html`'s `<title>`, and
release-please's `package-name`. That last affects the changelog heading only —
`include-component-in-tag` is already false, so tags keep their shape and version
history is continuous.

**Changing the identifier moves the app-data directory**, orphaning the existing
database, settings, window geometry and crash log. Accepted at v0, and it is why
migration 6 needs no backfill.

The version string stayed in the status bar rather than moving to the title bar
here — phase 34 rebuilds that bar from scratch, so moving it early meant CSS
thrown away and four tests edited twice.

**The repository was deliberately not renamed**, and the follow-up for it was
later dropped. GitHub redirects the old name, so the only real cost is the raw
`ci/screenshots` URLs in every merged pull request body, which a rename breaks
for good.
