# 205 — A control character is escaped in the log

```
err scan.unreadable error=…\01 Star Power Airlines.mp3: … failed to parse frame 'TDRC' <- unexpected character ' '
```

The "space" is a raw NUL from the file's `TYER` (see
[204](204-a-bad-tag-item-does-not-hide-the-file.md)). `Fields::add`
(`log.rs:226`) replaces only `\n` and `\r`, so a NUL makes the line misleading
and makes grep and rg treat main.log as binary. Every line goes through
`Fields`.

- `\n`/`\r` still become a space. Every other `char::is_control` character
  becomes `\u{N}` (`char::escape_unicode`). Not `\xNN`: the paths already
  hold backslashes, and `\01 Star Power` would read as an escape.
- Update the `Fields` doc comment ("written as they are").
- A test: a value with a NUL and a tab.
