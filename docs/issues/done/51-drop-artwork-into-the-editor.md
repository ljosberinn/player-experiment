# 51 — Drop an image onto the artwork square

Dropping a JPEG or PNG onto the cover — or onto the placeholder from
[phase 50](50-tag-editor-artwork-block.md) — sets it as the replacement, the
same state `Choose Artwork…` produces.

The obstacle is that the editor's cover travels as a **path**:
`CoverEdit::Replace { path }`, which `read_cover` (`tags/write.rs`) opens with
`std::fs::read`. An HTML5 drop hands over a `File` — bytes, no path. The native
drag-drop event that carries paths is unavailable and stays that way:
`dragDropEnabled` must remain `false` or in-app dragging stops working, and
Tauri v2 cannot toggle it at runtime ([gotchas](../../knowledge/gotchas.md),
[limitations](../../knowledge/limitations.md)).

## Bytes go over IPC once, at drop time

Not at save time, and not as base64. Tauri sends a raw body only when the
*whole* `invoke` payload is an `ArrayBuffer` or a view of one; a `Uint8Array`
inside an args object is JSON-serialized as an array of numbers, four-ish bytes
per byte (`tauri`'s `scripts/process-ipc-message-fn.js`). Base64 in a field
costs 1.33x and then sits in React state for the life of the dialog. A raw body
costs nothing and is refused or accepted while the pointer is still over the
square, which is where the message belongs.

So: a new command that stages the drop and hands back a path, leaving
`CoverEdit`, `TagEdit`, the bindings and `write.rs` untouched.

- **`stage_dropped_cover(app, request: tauri::ipc::Request)`** in
  `commands/mod.rs`, returning the staged path. A JSON body is an error, not a
  fallback. It applies `MAX_COVER_BYTES` and the magic-byte sniff — extracted
  from `read_cover` so the cap and the sniff keep one home — then writes to a
  fixed name under `app_cache_dir()`, extension from the *sniffed* mime, not
  the file's. One name means each drop overwrites the last and at most one
  stray file exists. `File.type` is derived from the extension and is why the
  sniff is the authority.
- `read_cover` stays as it is and re-reads at save. The duplicate validation is
  the point: staging refuses early the way `numericProblem` does, and the save
  path stays the last line.
- `stageDroppedCover(bytes: ArrayBuffer)` in `ipc/index.ts` passes the buffer
  as the whole payload — `invoke("stage_dropped_cover", bytes)`, no wrapper
  object, or the raw route is silently lost.

## The editor

`TagEditor` stays presentational: a new `onDropCover: (file: File) => Promise<string>`
prop beside `onPickCover`, wired in `App.tsx`, resolving to a path or rejecting
with the sentence to show.

`.tag-cover` gets `dragOver` and `drop`. Accept only files: bail when
`hasTrackIds(event.dataTransfer)` — a song dragged from the table is not
artwork — and otherwise require `"Files"` in `types`, since `dragover` sees
types and nothing else (`playlists/drag.ts`).

The error line needs state it does not have. `problem` is derived
(`numericProblem(draft)`); a rejected drop is an event. Add a `rejected`
string, render `problem ?? rejected`, and clear it on the next drop or pick.
`canSave` keeps keying off `problem` alone — a refused drop must not block
saving a typed field.

## A miss currently navigates the window away

Nothing calls `preventDefault` on a window-level `dragover`/`drop`, so a file
dropped anywhere outside a handler makes WebView2 open it and the app is gone
until relaunch. That is true today; inviting people to drop images onto a small
square is what makes it likely. A guard at the window belongs in this phase.

## Not in this phase

Previewing the dropped image in the square. Phase 50 draws the square and the
replaced state stays a caption; an object URL for the `File` is a later,
separate change.
