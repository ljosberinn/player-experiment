# 105 — A comment lofty will not write back

A `COMM` frame whose three language bytes are not ASCII letters makes every save
of that file fail:

```
err tags.write.fail path=… stage=save tag=Id3v2/primary
  cause=failed to write Id3v2 tag <- failed to write frame 'COMM'
     <- invalid frame language found: \x00\x00\xb0 (expected 3 ascii characters)
```

lofty's `LanguageFrame::parse` takes the bytes as they come; only its encoder
checks them. Nothing in the edit can clear it: the language rides on the
`TagItem`, so it survives the split to a generic `Tag` and the merge back, and
an edit that never mentions the comment writes the same bytes out again.

`write::repair_languages` rewrites an unusable language to `XXX` after the
conversion to `Id3v2Tag` and before the save, for `COMM` and `USLT` alike. The
text is untouched — only the claim about what language it is in, which carries
nothing a user could want back.

Same family as the unwritable dates of
[100](100-why-a-tag-write-failed.md), and repaired rather than reported for
the opposite reason: a date is a value someone chose, a language byte nobody did.
