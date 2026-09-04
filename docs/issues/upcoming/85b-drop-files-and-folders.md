# 85b — Drop files and folders into the library

What a drop then does. [85a](85a-the-window-takes-os-drops.md) is what makes
paths arrive at all; this is the ingest behind them, and it is the second thing
in the app — after File ▸ Add Folders… — that puts music in the library.

## A folder is the easy half

**A dropped folder becomes a watch folder**, exactly as the picker does, and a
scan follows. Several folders in one drop are all added and then scanned once,
not once each.

## A loose file needs somewhere to live

The scanner is root-driven: `plan` adds what is under a root and marks
everything else missing. A file dropped from Downloads has no root over it, and
adding its parent instead would pull the whole of Downloads into the library.

So a file drop needs [83c](83c-turning-the-library-folder-on.md) switched on,
and **with it off a file drop is refused and says why**.

**The move happens before the row exists, not after.** Insert first and there is
a window in which a row points outside every watch root, and the very next
`plan` — a timer tick away — marks it missing. So the file is placed by
[83a](../done/83a-where-a-file-goes.md)'s layout and moved by
[83b](83b-moving-one-release.md)'s primitive first, and inserted at the target.
That is the seam 83b has to leave: the file-level move, without the row update
that a dropped file has no row for yet.

- **Non-audio in a dropped selection is ignored**, not an error. `is_audio_file`
  already decides this.
- **A drop lifts the tombstone**
  [73](../done/73-remove-a-song-from-the-library.md) left, on the path the file
  is dropped *from* — or dropping a song that was removed once would silently do
  nothing. 83b's mover deals with the same table at the other end.
- **A mixed drop with organizing off** adds the folders and refuses the files,
  in one sentence rather than one per file.

## The shape of it

One command taking the paths and returning what it did — folders watched, files
added, files refused — reported through the status channel
[61](../done/61-one-status-channel.md) already owns, and written down through
`log::Op` per [86](../done/86-every-operation-in-a-logfile.md), which named this
ingest as one of the sites it exists for. One `library://changed` at the end,
not one per file. `#[derive(TS)]` on the summary, so `npm run bindings` runs.

*Open:* what a drop looks like while it is in flight. `enter` carries the paths,
so the window can say what it is about to accept before the button is released,
and it is the one thing here with no precedent in the app to copy. Recommendation:
the same outline treatment the artwork square gets, on the song table, and no
per-file progress — an ingest is a scan, and `ScanBar` already reports one.

The [limitations](../../knowledge/limitations.md) entry on folder
drag-and-drop ingest goes when this lands.

Testing: the ingest command over a `tempfile` tree — a folder asserted watched
and scanned, a mixed selection asserted to ignore its non-audio, a file drop
with organizing off asserted refused and asserted to have moved nothing, and a
dropped file whose path is tombstoned asserted present afterwards. The drop
itself stays uncoverable in e2e, per 85a.
