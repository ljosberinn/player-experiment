# 81 — Two casings, two tiles

`A Sense Of Purpose` and `A Sense of Purpose` are two tiles in Releases, both
In Flames, sorted adjacently so the duplication is unmissable. The browse view
groups by the raw `album` and `GROUP_ARTIST` columns but orders by them
`COLLATE NOCASE`, so a pair that differs only in case is two groups printed side
by side. 37 tiles in this library are that: grouping both keys `COLLATE NOCASE`
takes it from 8,044 groups to 8,007.

Both keys, not just the album: `Wrath Of The Weak` and `Wrath of the Weak` split
an album the same way, and one pair is two casings of `ASP` on tracks with no
album tag at all.

Nothing else is needed — no migration, no network, no MBID. It is the only part
of the duplicate-tile problem that is a bug in the query rather than a gap in
the tags; the rest is [86](86-one-release-one-tile.md).

**The drill-in has to fold case too.** `scope` filters with
`{key_sql} IS ?` against the key the tile was labelled with, so folding the
grouping alone would open a tile and show only the tracks whose casing happened
to win. Both conditions get the same collation as the `GROUP BY`.

**One casing wins the label.** `key` and `secondary` become `min()` over the
group, which is a binary comparison, so the uppercase variant is the one shown —
arbitrary but deterministic, which is what `groupId`'s React keys need. The
files keep whatever they carry; this decides a label, not a tag.

`NOCASE` is ASCII-only, so `Ä` and `ä` would stay two groups. Measured against
this library there is no such pair, so it buys nothing to reach for ICU here.

[79b](79b-online-release-lookup.md) groups its lookup selection by the same
expression. Folding case there too stops one release being searched twice at one
request per second.

Testing: a seeded pair differing only in album case asserted to be one group and
a pair differing only in artist case likewise; the drill-in on that group
asserted to return both casings' tracks; the untagged group asserted unchanged,
since `nullif` still runs before the collation.
