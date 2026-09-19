# 85b — Drop files and folders into the library

What a drop then does. [85a](85a-the-window-takes-os-drops.md) is what makes
paths arrive at all; this is the ingest behind them, and it is the second thing
in the app — after File ▸ Add Folders… — that puts music in the library.

## A folder is the easy half

**A dropped folder becomes a watch folder**, exactly as the picker does, and a
scan follows. Several folders in one drop are all added and then scanned once,
not once each.

**A folder already under a watch root is skipped**, not added again. The scan
already walks it, and a redundant nested root is a row in Settings that does
nothing.

## A loose file needs somewhere to live

The scanner is root-driven: `plan` adds what is under a root and marks
everything else missing. So where a dropped file is decides what happens to it,
and there are three cases, not two.

- **Already under a watch root.** Nothing moves. The scan's next pass finds it
  where it is. This is the drag-it-back-in case
  [73](73-remove-a-song-from-the-library.md) left open, and refusing it
  for want of [83c](83c-turning-the-library-folder-on.md) would be
  refusing the one drop that needs no filesystem work at all.
- **Outside every root, with 83c on.** The file is moved under the Library
  folder, which 83c guarantees is watched.
- **Outside every root, with 83c off.** **Refused, with the reason.** Adding
  the file's parent instead would pull the whole of Downloads into the library.

### It lands at the root's top level, not at its target

83a's layout is a function of a *release*: `mover::shape` resolves `GROUP_ARTIST`
across the release's rows, takes the year most of them agree on, and counts
discs over all of them. A file with no row yet answers none of that, so a target
computed here would be a **third** answer to where a file goes, and one that
differs from what `survey` computes — which means the worker moves the file a
second time, every time. 83c is explicit that two answers to that question is
the defect.

So the drop puts the file at `<root>/<filename>` — [83b](83b-moving-one-release.md)'s
`place_file`, which is the seam 83b left for exactly this: the file-level move
without the row update a dropped file has no row for yet — and `library::worker`
files it properly on its next sweep. That sweep is running by construction: this
is the branch that requires organizing to be on.

A name already taken at the top level gets 83a's ` (n)` marker, through
`mover::free_target`.

### The move happens before the row exists, and the scan makes the row

Insert first and there is a window in which a row points outside every watch
root, and the very next `plan` — a timer tick away — marks it missing. But the
ingest does not need to insert at all: once the file is under a root, **the scan
that a drop runs anyway is what inserts it**, with the tags it reads itself. No
`insert_track` at this site, no tags read twice, no second answer to what a row
for that file looks like.

- **Non-audio in a dropped selection is ignored**, not an error. `is_audio_file`
  already decides this.
- **A drop lifts the tombstone** [73](73-remove-a-song-from-the-library.md)
  left — on the path the file **ends at**, not the one it came from. `plan`
  skips a tombstoned path *before* marking it seen, so a tombstone on a path
  nothing sits at any more is inert; the one that bites is the target's. That is
  the same `removed_paths` row `move_release` deletes inside its transaction and
  `place_file` deliberately does not. For a file that does not move, the two
  paths are the same path.
- **A mixed drop with organizing off** adds the folders and refuses the files,
  in one sentence rather than one per file.

## The shape of it

One command taking the paths and returning what it did — folders watched, files
moved, files adopted where they lay, files refused — reported through the status
channel [61](61-one-status-channel.md) already owns, and written down
through `log::Op` per [86](86-every-operation-in-a-logfile.md), which
named this ingest as one of the sites it exists for. `#[derive(TS)]` on the
summary, so `npm run bindings` runs.

**No `library://changed` of its own.** The command prepares the filesystem and
the tombstones; the rescan that follows is the existing one, through
`useScanStore.rescan()`, which already announces, already drives `ScanBar`, and
already holds the `busy` guard that stops a second drop landing on top of the
first. The drop handler is `addFolder` with the dialog replaced by the paths.

## What it looks like in flight

`enter` carries the paths, so the window can say what it is about to accept
before the button is released. The target is `.content`, the library pane,
outlined the way `.sidebar-row.drop-target` is — the same treatment 85a gives
the artwork square. **The pane and not the song table**: the table is not
rendered in the empty state, which is exactly where a first drop lands, nor on
the views that browse rather than list. No per-file progress: an ingest is a
scan, and `ScanBar` already reports one.

It holds no React state. `useLibraryDrop` hands `App` a ref and toggles a class
on the element; a `useState` here would render the view with 150k rows in it for
every pointer crossing.

**85a's registry has one slot**, and the tag editor's artwork block owns it. A
second target makes it a stack, hit-tested from the top down, so the modal on
top still wins while it is open.

The [limitations](../../knowledge/limitations.md) entry on folder
drag-and-drop ingest goes, replaced by the narrower one this leaves: a loose
file from outside every watch folder still needs the Library folder on.

Testing: the ingest command over a `tempfile` tree — a folder asserted watched,
a folder already under a root asserted skipped, a mixed selection asserted to
ignore its non-audio, a file outside every root with organizing off asserted
refused and asserted to have moved nothing, the same file with organizing on
asserted at the root's top level, a file already under a root asserted untouched
and its tombstone asserted lifted, and a collision at the top level asserted
suffixed. Plus the registry stack: a second target asserted to take the drop
where the two overlap, the first asserted to take it where the second is missed,
the hover asserted to hand over between them, and the first asserted to have it
back when the second unmounts.

The OS leg stays uncoverable in e2e, per 85a, so `library-drop.test.ts` emits
what it produces: the outline captured from `tauri://drag-enter`, and one
`tauri://drag-drop` of a loose file. **Only the refused case is dropped there.**
One app process serves the whole run and the specs after it count what a scan
found, so a drop that landed would change their subject.
