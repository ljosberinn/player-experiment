# 100 — Why a tag write failed

"Failed to write mpeg file" has been seen repeatedly and never reproduced. The
string is lofty's `FileEncodingError`, which prints the `FileType` and nothing
else, and the app shows only that: `apply` collects `error.to_string()` and the
editor renders `errors[0]`. Everything that separates the causes is in
`source()`, which was thrown away.

Investigation confirmed two classes, both reaching the user as that one
sentence:

- **I/O during the rewrite.** lofty reads the whole file into memory,
  truncates it and writes it back, so a full disk (OS error 112), a file another
  process holds open (32) or a volume that goes away mid-write all surface here.
  `write_file` copies first, so an edit needs twice the file size free.
- **An out-of-range `TDRC`/`TDOR`.** lofty parses `2012-13` or `2012-06-45`
  happily and `Timestamp::verify` then refuses to write it, so the file is
  permanently un-editable. The frame lives in the `Tag`'s companion rather than
  its items, so clearing Year does not rescue it. See
  [gotchas](../../knowledge/gotchas.md#tag-writing).

Not a fix — the causes are known but the incidence is not. This makes the next
occurrence readable.

- `apply` returns `Written { summary, diagnostics }`: the summary crosses IPC
  unchanged, the diagnostics stay in the backend, one `Fields` per failed file.
- `commands::noting_failures` writes them as `tags.write.fail` lines. The
  command layer, because that is where a `Log` already is — threading one into
  `pass::look_up` would have touched twenty call sites to serve a path that
  discards its failures anyway.
- Each line carries `path`, `stage` (copy/probe/save/rename), `size`, `temp`
  (how far the rewrite got before it stopped), `os`, the `cause` chain, and for
  a save the tag's `frames`, `pics`, `picbytes` and `dates`.
