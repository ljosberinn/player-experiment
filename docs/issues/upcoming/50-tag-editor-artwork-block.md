# 50 — The artwork block in the tag editor

`.tag-cover` (`editor/TagEditor.tsx:107`, `App.css:1563`) is a flex row holding
one of four mutually exclusive things — the cover, or a sentence standing in for
it — followed by two or three buttons. It should be a square with a caption, and
a button row under it.

**The cover has no size.** `.status-cover` is written in the markup
(`TagEditor.tsx:113`) and queried by a test (`TagEditor.test.tsx:179`), and that
is the whole of its existence: no rule anywhere sets it. The image draws at its
intrinsic size, so a 3000px embedded cover draws at 3000px and `.modal`'s
`max-height: 86vh; overflow: auto` (`App.css:1598`) turns the dialog into a
scroll area.

**A song without artwork gets a sentence instead of a square.** "No artwork." /
"Artwork differs or is missing." occupy the image's place, so the block changes
shape with the selection, and again when a choice is pending ("New artwork
selected." / "Artwork will be removed."). The square should always be drawn; the
sentence is a caption beside it, not a replacement for it.

**The buttons share the image's line.** `Choose Artwork…`, `Remove Artwork` and
`Keep Existing` belong on their own row under the square.

## Shape

- `.tag-cover` becomes a column: square plus caption on the first row, buttons on
  the second.
- One rule for the square, on the image and on the placeholder alike, following
  `.now-playing-cover` (`App.css:825`) — fixed width and height,
  `object-fit: cover`, a radius, and a `box-shadow` hairline rather than a
  border, which would eat into the art. An `-empty` variant fills it with
  `--skeleton`, as `.now-playing-cover-empty` and `.browse-cover`
  (`App.css:2059`) both do. The placeholder is `aria-hidden`, the image keeps
  `alt=""`; both are decorative, as in `NowPlaying.tsx:44-46`.
- Rename `.status-cover` while touching it — it names a status column this
  dialog has nothing to do with. `.tag-cover-art` matches the block.

To decide:

- **The size.** The two squares in the app bracket it — 44px in the transport
  strip, 158px in the albums grid — and neither suits a dialog. 96px is the
  proposal. `docs/knowledge/design.md` lists no mockup of this dialog, so there
  is nothing to reproduce; re-fetch the design project before assuming that.
- **Whether a pending replacement previews.** It cannot today: `CoverEdit`
  carries a path, and the asset protocol is not enabled
  (`src-tauri/capabilities/default.json`, and no `assetProtocol` block in
  `tauri.conf.json`), so the webview cannot read a picked file. The caption
  stands for now; [phase 51](51-drop-artwork-into-the-editor.md) brings bytes,
  which a preview could use.
- **Whether this is worth a photograph.** No e2e spec opens the editor, so a
  `capture()` of it would be new ground rather than a line added to an existing
  spec.

Pinning it: `App.css.test.ts` already asserts a stated height and `object-fit`
for `.now-playing-cover` (the "fixed height, not a growing one" test) and the
same assertion covers this square; `TagEditor.test.tsx` needs the renamed
selector, and a case per state that the square is drawn at all.

Phase 51 drops an image onto this square. It needs the placeholder to be the
same box as the cover, which is what this makes it.
