# 181 — A file that cannot be read says so

A file whose tags lofty refuses is dropped by the scan without a trace:
`scan added=0`, no row, nothing in the log. 146 files in the library today,
each over one bad frame or APE item — a `WXXX` holding a bare URL, UTF-16 of
odd length, a truncated `RVA2`. lofty's own message names only the format
(`failed to parse Mpeg file`).

## Fix

- `tags::read` errors carry lofty's whole chain
  (`… <- failed to parse frame 'WXXX' <- ID3v2 frame specifies invalid text encoding`).
- `ScanSummary.unreadable` counts them, on the `scan` and `scan.watch` lines.
- A scan the user asked for writes `err scan.unreadable` per file. The watch
  pass does not: the file is read again every pass.

## Verification

- `scan` test: a bare-URL `WXXX` is counted and named, frame included, on
  every scan.
- Drop `D:\dl\Why Aren't You Laughing`: 11 `scan.unreadable` lines naming
  `'WXXX'`, and `scan … unreadable=11`.
