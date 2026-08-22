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
- Every colour comes from a custom property. **No literal colour outside the
  token block** in `App.css` — that is what keeps a light theme cheap to restore.
- Allowlists, never denylists, for anything that leaves the machine.
  `settings::EXPORTABLE` is an allowlist so a credential added later cannot leak
  by being forgotten; an unknown key is not exported.
- `unsafe_code = "forbid"` in the Rust crate. An exception belongs in its own
  two-function module, so it stays visible and bounded.
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
- **One bad file does not undo the good ones.** A locked file mid-batch is
  counted and reported; the rest are written, and failures are not journalled.
- **Undo is one level and is not itself undoable.** A snapshot restores every
  field, because an edit that *added* a value has to be cleared.
- **A destructive action names the cost that is easy to miss**, and Cancel takes
  focus, so a reflex Enter destroys nothing.
- **Changing source resets the view.** Opening a playlist clears the search and
  selection.
- **A sidebar item is named for its destination, not its size** — the count is
  visible but `aria-hidden`.
- **Icon-only cells are not labels**: visually-hidden text, and never colour as
  the only signal.
- **Scope is derived from the view, not asked in a dialog** — a selection beats
  an open playlist beats the library, and the button says which.
- **A failure the user did not ask for stays quiet**; a failure of something they
  did ask for is reported.
