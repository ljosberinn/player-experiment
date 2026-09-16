# 82m — A marker only survives while something holds the name

[82i](82i-paths-compare-byte-exact.md) made `survey::at_target` accept any
` (n)`, which is what stopped the loop. It accepts too much: a marker the loop
itself left behind, whose plain name nothing holds, reads as placed on every
sweep and is never offered to the mover that would take it off. 819 present
files across 132 folders carry one — `(2)` through `(13)`, and one release at
`(30)`, one number per sweep they were in.

`mover::free_target` already answers this, and `move_release` already acts on
it: a re-offered release finds its ideal free, so `layout::same(target, source)`
is false and the rename commits with the row. A marker that is a real collision
— two releases sanitizing to one name — finds the ideal owned by the other
release's row and keeps the number it has.

**`placed` asks `free_target` rather than guessing.** `at_target` goes — two
answers to where a file goes is the defect the module already names — and
`collision_nth` keeps only the half that is still needed: whether the file wears
a marker at all. A file already at its ideal never reaches the ask, so the
placed library still costs no query per file and the stat behind
`removed_by_hand` lands only on the markers.

The mover asks with the release's in-flight `taken` and the survey asks with
none, so the mover's answer can only be the survey's or higher. After a move
every file's row owns its target, so the next survey reproduces that choice —
a release whose own two files sanitize to one name settles in one extra pass
rather than looping.

750 of the 819 have their plain name held by a row marked missing, which
`owned_by_other` counts on purpose: `UPDATE tracks SET path` would otherwise
collide with that row when the drive comes back. They come down after File ▸
Remove *n* Missing Songs, which already carries the count in its label and the
cost in its dialog — which is why the readout this issue originally asked for
was cut.

Testing: a marked file whose ideal is free asserted unplaced and asserted
renamed down by the mover; a marked file whose ideal a present row of another
release holds asserted placed; a marked file whose ideal a missing row holds
asserted placed; a release whose own two files sanitize to one name asserted to
settle in one pass and stay settled.
