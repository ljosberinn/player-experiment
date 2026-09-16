# 82m — Undoing the placement loop

What [82i](../done/82i-paths-compare-byte-exact.md) and
[82j](../done/82j-the-path-the-mover-asked-for.md) leave behind. **It runs
after both**, or it re-creates what it cleaned on the next sweep.

## The rows

2,072 rows are marked missing. The 492 that fold onto a present row's path are
[82i](../done/82i-paths-compare-byte-exact.md)'s, merged by the migration that collides
on them. **The other 1,580 are this one's**: earlier generations, whose file has
since been renamed to the next marker, so nothing folds onto them and nothing
proves what they are.

They are indistinguishable from a drive that is not plugged in, which is why no
migration may decide about them. `tracks.remove_missing` already takes rows like
these and the user has already run it once, on 2026-09-04, for 2,912 of them.
**What is missing is the readout that says there are 1,580 and what they are**,
rather than a menu item whose cost is only visible after it has run.

## The names

819 present files carry a ` (n)` collision marker across 132 folders, one number
per sweep they were in — `(2)` through `(13)`, and one release at `(30)`.
`at_target` accepts a marker on purpose, so once
[82i](../done/82i-paths-compare-byte-exact.md) lands they read as placed and keep the
number they have.

For 750 of them the unsuffixed name is held by a missing row and by nothing
else; for 69 it is free already. After the rows above are gone, all 819 are.

**A pass that renames each marked file down to the lowest marker no row and no
file holds**, through `free_target` so there is one answer to the question,
under `move_release`'s lock and transaction so a rename and its row commit
together. A marker that is a real collision — two releases sanitizing to one
name — finds the ideal taken and keeps the number it has.

## Not automatic

It walks 67,520 rows and renames some hundreds of files. A menu action beside
`tracks.remove_missing`, logged as its own op, run once.

Testing: a marked file whose ideal is free asserted renamed down with its row in
one transaction; a marked file whose ideal a present row of another release
holds asserted left at the number it has; the missing count asserted to report
rows the merge in [82i](../done/82i-paths-compare-byte-exact.md) has already taken.
