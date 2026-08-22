# 9 — JSON export, window geometry

Merged in `b26feae`. Schema: [export-schema.md](../../knowledge/export-schema.md).

- **Exported settings go through an allowlist** (`settings::EXPORTABLE`). Fail
  closed: an unknown key is not exported. That is what keeps a credential added
  later from leaking by being forgotten.
- **No artwork of any kind** — not the bytes, and not the hash. A test asserts
  the absence of the hash and of the string "cover" anywhere in the document.
- A smart playlist exports its **filter**, not its members; a membership list
  would be a lie the moment the library changed. Exactly one of `trackIds` and
  `filter` is present.
- The export scope is derived from the view — selection beats open playlist beats
  library — and the button says which.
- A maximized window stores the flag, not the bounds.

Two ACL holes shipped here and were found on real builds: `dialog:allow-save`
(export failed in the packaged app) and `setPosition`/`setSize` (geometry restore
would have failed on every launch). `src/ipc/capabilities.test.ts` exists because
of this phase.
