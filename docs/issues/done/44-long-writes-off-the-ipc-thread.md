# 44 — Tag edits and export no longer block the window

Both built their whole work on the IPC thread. A 500-file tag edit wrote one
mp3 after another with the dialog sitting still, and an export built the entire
document in memory at the moment the user picked a filename. Both now get the
treatment scanning already had: `spawn_blocking` plus a progress event.

Four commands did enough file I/O to freeze the window, so the three lines
around `spawn_blocking` became `commands::blocking`, which `scan_library` uses
too. Its `what` argument appears only in a join failure — a panic in the worker
— because without it every such failure reads the same and says nothing about
which one it was.

## What reports where

| Write | Channel | Shown |
| --- | --- | --- |
| Scan | `scan://progress` | `ScanBar`, unchanged |
| Tag save | `tags://progress` | The editor dialog, which now stays open across the write |
| Tag undo | `tags://progress` | `TaskProgress`, beside `ScanBar` |
| Export | `export://progress` | `TaskProgress` |

`WriteProgress` is one type for both new channels because a progress readout is
a fraction and neither has anything else to say. What each is counting is the
channel's business, not the payload's.

## Decisions

**The export is still written whole rather than streamed.** That was already
settled and still holds — a partial file left behind by a failure looks like a
complete one. What moved is where the building happens.

**The export counts first**, so the readout is a fraction rather than a rising
number with nothing to measure it against. It is one more query against an
index next to a read of every row it counts. A selection is its own length; the
ids are in hand.

**Tag progress emits every 25 files, not every one.** A tag write is a whole mp3
copied and replaced, so a file is milliseconds — per-file emission would put
hundreds of events a second on the IPC channel to move a readout by a pixel.
Both loops emit once at the start and once at the end regardless, so the
readout never stops short of its own total while the database transaction runs.

**The count is against every id asked for**, not the ones that turned out to
have a row. A selection naming rows a rescan has since removed would otherwise
leave the readout short of its total forever.

**A save keeps its dialog open and disables Cancel.** The write cannot be called
off — the files already changed are already changed — and a modal that closes
mid-write would report its result to a screen the user has moved on from.

**A tag save is deliberately absent from `TaskProgress`.** Its dialog is in
front of the content header; reporting there would be reporting from a place
the user cannot see.

The failure-reporting rule is unchanged: one bad file is counted and reported,
the rest are written, and failures are not journalled.

## Tests

- `export/mod.rs` — progress over several pages reaches its own total and never
  moves its denominator; a selection counts the ids it was handed.
- `tests/tagwrite.rs` — a batch including an id the library does not have still
  lands on the count it was asked for; an undo reports too.
- `export/store.test.ts`, `editor/store.test.ts` — busy and progress across
  success and failure, and that a save shows a fraction from the moment the
  button is pressed rather than from the first event.
- `TaskProgress.test.tsx` — which of the two channels it draws, that an export
  with no report yet says only that it is running, and that a save is left to
  its dialog.
- `TagEditor.test.tsx` — the readout, the disabled buttons, and Escape held off
  while a write runs.
