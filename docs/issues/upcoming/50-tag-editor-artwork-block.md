# 50 — The artwork block in the tag editor

`.tag-cover` is a flex row of an image and two or three buttons
(`editor/TagEditor.tsx`, `App.css`). Three things are wrong with it.

**The cover is drawn at its intrinsic size.** `.status-cover` has no rule
anywhere - the class exists only in the markup and in a test's selector. A
3000px embedded cover renders at 3000px, and `.modal`'s `max-height: 86vh;
overflow: auto` turns the dialog into a scroll area. It needs a size of its own
(square, `object-fit: cover`, a hairline ring) - `.now-playing-cover` is the
pattern, at a size that suits a dialog.

**A song without artwork gets a sentence.** "No artwork." / "Artwork differs or
is missing." sits where the image would be, so the block changes shape with the
selection. Draw the same square as a placeholder - `.now-playing-cover-empty`
already fills one with `--skeleton` - and keep the wording as a caption beside
or under it rather than in place of it.

**Choose Artwork… and Remove Artwork share the image's line.** They belong on
their own row under the square, with "Keep Existing" when it appears.

Same block, same pass. Dropping an image onto it is
[phase 51](51-drop-artwork-into-the-editor.md), which is not.
