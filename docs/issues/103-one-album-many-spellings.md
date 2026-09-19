# 103 — One album, many spellings

A play keeps the album as it was scrobbled, which is right, and Statistics
groups albums on that text, which is not. Streaming services rename releases:
`Addicts: Black Meddle Pt. 2` (929 plays), `Addicts: Black Meddle Pt. II`
(132), `Addicts: Black Meddle, Pt. II` (50) and `Addicts: Black Meddle Part II`
(1) are one record heard 1,112 times, drawn as four albums none of which reach
the top list where the whole would.

Across the 237,675 plays in the real log: **217 groups, 250 redundant album
rows, 4,146 plays (1.7%)** attributed away from their biggest spelling. By
cause — a parenthetical edition marker (155 groups, 2,760 plays), punctuation
(46 / 732), roman against arabic `Pt.` (3 / 344), diacritics (7 / 294),
non-ASCII case (1 / 2).

Only the play log has this. `tracks` is tagged one way per release, so the
Library tab and `query::release_identity` are already whole.

MusicBrainz cannot decide it either: its title for this release is
`Addicts: Black Meddle, Part 2`, a fifth spelling that none of the 1,112 plays
carry. Nor can its ids — 21,384 of 237,675 plays (9%) reach a
`release_group_mbid` through `plays.track_id`, and an imported scrobble with no
file never will.

## Shape

A fold computed in Rust, materialized per distinct spelling, and overridable.
Normalization is Rust-side for the reason `plays.rs` already gives: `lower()`
and `COLLATE NOCASE` are ASCII-only, and the 294 plays behind
`Confessions D'Un Voleur D'Ames` against `Confessions d'un Voleur D'âmes` need
diacritics folded, which neither does.

### Migration — the grouping

```sql
CREATE TABLE album_groups (
    artist  TEXT NOT NULL,          -- the play's own artist, verbatim
    album   TEXT NOT NULL,          -- the play's own album, verbatim
    key     TEXT NOT NULL,          -- the fold, for finding the group
    heading TEXT NOT NULL,          -- the spelling this group is shown under
    pinned  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (artist, album)
) WITHOUT ROWID;
CREATE INDEX idx_album_groups_key ON album_groups(key);
```

One row per distinct `(artist, album)` in `plays`, joined back on that pair
under the binary collation — the pass enumerates the spellings verbatim, so an
exact match covers every row, and `COLLATE NOCASE` on the join would fold ASCII
only anyway.

`heading` is a spelling out of the user's own history, never an invented title:
the group is named after its most played member. That is also why `heading`
doubles as the group's identity — `ListenQuery::album` stays a title string and
`StatsCrumb` does not change.

### The fold

`plays::album_key(artist, album)`, sibling to `match_key` and conservative in
the same way:

- `to_lowercase`, NFKD, combining marks dropped. NFKD rather than NFD because
  `…` is one codepoint that only compatibility decomposition turns into `...`,
  which is the whole of the Marathonmann group (3 spellings, 184 plays).
- a trailing ` - EP` or ` - Single`, and a trailing ` - Deluxe…`,
  ` - Remastered…`, ` - Expanded…`, ` - Anniversary…`.
- a parenthetical or bracketed run containing `deluxe`, `remaster`, `bonus`,
  `expanded`, `anniversary`, `edition`, `explicit`, `reissue` or `premium`.
- `Pt.`/`Part` followed by a roman numeral, rewritten to arabic.
- remaining punctuation to spaces, whitespace collapsed.

**`version` and `special` are deliberately not in the vocabulary.** Stripping a
bare `(… Version)` would fold `(Live Version)` and `(Acoustic Version)` into
the studio cut, which is the failure `match_key` refuses for the same reason.
Keeping them out costs 11 groups and 152 plays, all of which the edition words
above would have caught by another route.

### The pass

`plays::regroup(conn)`, following `resolve`: recompute rather than maintain.

- Full pass after an import (`import.rs:155`, beside `plays::resolve`) and once
  when a `settings` marker says the fold's version has moved. 13,708 distinct
  spellings, so it is cheap.
- A local play whose `(artist, album)` has no row gets one: its key looked up
  in `idx_album_groups_key`, taking that group's heading, or its own spelling
  when the group is new.
- Headings are re-chosen only on a full pass. A variant overtaking the leader
  mid-session would rename a row under the cursor.
- `pinned = 1` rows survive the pass, and a pinned heading wins for the
  unpinned rows folding to the same key — otherwise a retitled group would
  revert the moment a new spelling arrived.

### Reading it

`Plays::clause` gains `LEFT JOIN album_groups ON album_groups.artist =
plays.artist AND album_groups.album = plays.album`, unconditionally and for the
same reason the `tracks` join is unconditional. Album identity becomes
`coalesce(album_groups.heading, plays.album)` at all three sites:

- `top`, `ListenDimension::Album` — key and `GROUP BY` (`stats.rs:264-267`).
- `listen_totals` — the distinct album count (`stats.rs:169`).
- `Plays::new` — the `album` filter (`stats.rs:77-79`), so drilling a merged
  album reaches every variant's plays.

`recent_plays` and the CSV export keep the play's own spelling. A play is a
historical fact; only the aggregates group.

### Correcting it

The fold is automatic and wrong sometimes, so every group is editable, the way
`genre_overrides` makes the genre tree editable. An album row in **Top albums**
opens `AlbumLinkDialog`, modelled on `GenreOverrideDialog`:

- the spellings folded into this group and their play counts,
- which one heads it,
- separate a spelling out — pin it with its own spelling as `heading`,
- merge another album by the same artist in — pin it with this heading.

All three are the same write: pin a row with a heading. No second mechanism.

## Changes

- `db/schema.rs`: the migration above, appended.
- `db/plays.rs`: `album_key`, `regroup`, and the per-insert row.
- `db/stats.rs`: the join, the three identity sites, `pin_album` /
  `album_group` for the dialog.
- `lastfm/import.rs`: `regroup` beside `resolve` at the end of a run.
- `commands/`: `stats_album_group`, `stats_pin_album`.
- `src/features/stats/panels/AlbumLinkDialog.tsx`, opened from `TopPanel`.

Testing: Rust — `album_key` over one case per cause, and the negatives that
matter (`Pt. 1` and `Pt. 2` stay apart, `(Live Version)` is not stripped,
`(Deluxe Edition)` is); `regroup` picking the most played spelling as heading,
leaving pinned rows alone, and a pinned heading claiming a later unpinned
sibling; the three read sites over a fixture with the four `Addicts` spellings,
including that the drill-down returns all 1,112. Frontend — the dialog's three
writes. An e2e screenshot of the dialog is worth having if it ships as drawn.
