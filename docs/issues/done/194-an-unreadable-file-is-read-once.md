# 194 — An unreadable file is read once

A file whose tags do not parse gets no row, or keeps a stale one, so every
scan plans it again: 141 MP3s in the real library, over a second each when the
disk is cold. See [profiling](../../knowledge/profiling.md).

- `unreadable_files` (migration 21) records each by path, mtime, size and the
  app version that failed (`read_by`). `scan::plan` counts one as `unchanged`
  while all three match; a successful read deletes the record, and a record
  whose file was not walked is pruned unless its root is absent.
- A file an edit broke keeps its stale row, with the tags it last parsed to.
- `unreadable=` counts new failures only. The watch pass now names each in
  `scan.unreadable` too.
