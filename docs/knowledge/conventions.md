# Conventions

## Working

- One phase, one branch, one pull request, green CI. Numbers are permanent —
  code comments and PR titles refer to them.
- Commit titles are conventional commits; release-please reads them.
- A PR body keeps the `ci/screenshots` markers intact — CI splices images
  between them.
- Regenerate bindings (`npm run bindings`) whenever a `#[derive(TS)]` type
  changes; CI fails on drift.

## Code

- Comments explain non-obvious **why** — intent, invariant, constraint,
  workaround. Never narrate control flow. This codebase leans on that heavily:
  most surprising lines carry the reason they exist, and the reason is usually a
  defect that shipped once.
- Extract on the rule of three or genuine complexity; keep helpers local unless
  something else truly needs them.
- **Anything new on the backend gets written down where it makes sense.** A
  command that mutates, a job long enough to watch, or work a background thread
  does on its own runs through `log::Op` — `announcing`/`announcing_with` for a
  write, `Op::quiet` for a read, which is silent until it fails. Preference
  writes and the transport controls are the standing exceptions; see
  [architecture](architecture.md#what-is-written-down). A feature that is
  invisible when it goes wrong is how this file came to exist.
- Every colour comes from a custom property. **No literal colour outside
  `styles/tokens.css`** — that is what made the light ground a second column of
  values rather than an audit of six hundred rules, and what would make a third
  one cheap too. Every name is defined on *both* grounds; a token that exists on
  one and not the other loses its colour when the theme flips, silently and only
  for people using the other theme.
- Allowlists, never denylists, for anything that leaves the machine.
  `settings::EXPORTABLE` is an allowlist so a credential added later cannot leak
  by being forgotten; an unknown key is not exported.
- `unsafe_code = "forbid"` in the Rust crate. An exception belongs in its own
  two-function module, so it stays visible and bounded.
- **A story sits beside what it draws**, as `<Component>.stories.tsx`, and
  styles itself inline. Story scaffolding is not app chrome and has no business
  in the sheet; the tokens it reaches for through `var()` are the point of the
  exercise. Storybook's Ground toolbar writes the same `data-theme` the app
  does, so a specimen is drawn through the mechanism it documents.
- **CSS Modules were considered and declined.** They address collisions this
  project does not have, and they would weaken the cross-cutting `App.css.test.ts`
  guards that assert *absences* — jsdom applies no stylesheet under CSS Modules
  either, so they would not have caught any of the visual defects that motivated
  the e2e contrast suite.

## Product judgements that keep recurring

- **Absent means "leave alone", empty means "clear"** — every `TagEdit` field.
  It is what makes a bulk edit over disagreeing tracks safe.
- **The file is the source of truth.** Rows are re-read after a write, not
  assumed from the edit, and `mtime`/`size` update in the same step so an
  incremental rescan finds nothing to do.
- **A match is confirmed by hand unless it is not a guess.** The one place the
  app writes tags nobody approved is the release lookup pass, and only above
  `tagsource::score::UNATTENDED_THRESHOLD` — a release whose track count, track
  order and per-track durations all agree with MusicBrainz, or whose track count
  and title match the only candidate MusicBrainz returned. Below it nothing is
  written and a person decides. Confirming eight thousand certain matches by
  hand is not review, it is clicking, and a queue entry offering a choice of one
  is the same clicking; the threshold is where the line sits and it is a
  constant with its reasoning beside it, not a setting.
- **One bad file does not cost the good ones.** A locked file mid-batch is
  counted and reported; the rest are written.
- **A destructive action names the cost that is easy to miss**, and Cancel takes
  focus, so a reflex Enter destroys nothing.
- **Changing source resets the view.** Opening a playlist clears the search and
  selection, and lands on the tab its kind asks for - Releases for a smart
  playlist, Songs for a built-in, the open tab for a static one.
- **A sidebar item is named for its destination, not its size** — the count is
  visible but `aria-hidden`.
- **Icon-only cells are not labels**: visually-hidden text, and never colour as
  the only signal.
- **Scope is derived from the view, not asked in a dialog** — a selection beats
  an open playlist beats the library, and the button says which.
- **A failure the user did not ask for stays quiet**; a failure of something they
  did ask for is reported.
