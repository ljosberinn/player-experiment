# 195 — A play links to the copy of its song on the album it was heard on

Wolves in the Throne Room's `I Will Lay Down My Bones Among the Rocks and Roots`
and `Cleansing` show 0 plays on *Two Hunters*. The log holds 43 and 56 of
them, all scrobbled on *Two Hunters* (52) or *Two Hunters - Vinyl* (4). They
link to the same titles on *Live at Roadburn 2008*:

| id | album | `play_count` |
| --- | --- | --- |
| 64143 | Live at Roadburn 2008 | 43 |
| 64154 | Two Hunters | 0 |
| 64142 | Live at Roadburn 2008 | 56 |
| 64153 | Two Hunters | 0 |

Both copies share one `match_key`. `resolve`'s tiebreak
([plays.rs](../../src-tauri/src/db/plays.rs), the `play_keys` insert) is
present first, then the lowest id. It never reads the album on the play.
Roadburn has the lower ids, so it takes every play, and `count` raises it.

## Measurements

Measured on the reference library with a Python approximation of
`fold_album`:

- 3,203 keys name more than one track (7,331 tracks).
- 28,191 plays link through such a key to its tiebreak winner:

  | Play's folded album | Plays |
  | --- | --- |
  | Is a non-winning copy's (**moves**) | 13,990 across 1,106 songs |
  | Is the winner's | 12,399 |
  | Is no copy's | 1,638 |
  | Empty | 164 |
  | Is several copies' | 1,753 |

- 1,271 tracks go from no linked plays to some. 1,228 of them show 0 today.
  The largest: Isis *Panopticon* (`So Did We` 85, `Backlit` 76, `In Fiction`
  74), Rome `Der Brandtaucher` 85, Leonard Cohen *Songs of Leonard Cohen*
  (`Suzanne` 75, `So Long, Marianne` 74), Funkadelic `Maggot Brain` 72.
- 1,106 winners lose plays. On every one of them `play_count` equals the
  number of plays linked to it today, so the count comes from the log alone.

## Fix

In `resolve`, a key that names several tracks keeps all of them as
candidates, in tiebreak order. A play links to the first candidate whose
`fold_album(album)` equals the play's, or to the first candidate if none
does.

- An empty album on either side matches nothing.
- A key's candidates are its artist-key tracks when it has any, and its
  album-artist tracks only when it has none (135).
- The links go into `temp.copy_links`, ahead of `play_keys` in the one
  coalescing `UPDATE` (145). The copy tier shares the album tier's read of
  the log, which keeps `resolve` inside its `tests/perf.rs` budget.
- The album tier and the near-title tier are unchanged.
- `MATCH_FOLD_VERSION` goes to 9. `refold_if_stale` now runs `count` after
  `resolve`, since the scan after it skips both (193).

## Counts on the copy that loses plays

`count` only raises (136), so both copies would count a moved play. A
temporary trigger records each play that leaves a track. For each track that
loses one to another track, `resolve` works out its linked count and latest
`started_at` before the `UPDATE`. Where `play_count` (or
`last_played_at`) equaled that, it becomes what the track links afterwards
plus the plays that now link nowhere (NULL when nothing is left). A retag that
unlinks plays keeps their count, as `count` documents. A count above its links
holds local history from before migration 13 and stays. A play arriving
from nowhere is not recorded, so a track that also gains one keeps its count.

## Touches

- `plays::record`'s doc: a local play stays on the copy that played, unless
  two copies share its album or it has none.
- `scan::delete_handing_on` (169) hands on to the first remaining copy on the
  removed row's album, else the tiebreak winner, matching where `resolve`
  sends that album's plays.
- `docs/knowledge/data-model.md`.

## Out of scope

- `Two Hunters - Vinyl`: `fold_album` does not strip `Vinyl`, so those 4 plays
  keep the tiebreak winner. A new word in `FORMATS` is a `FOLD_VERSION` change
  of its own.
- `(Live)`-less titles on live albums. The key still cannot tell the
  recordings apart. The album on the play is what separates them here.

## Tests

In `plays.rs`: a play links to its album's copy; no or unmatched album goes to
the tiebreak; two copies on one album use the tiebreak; an album-artist copy
does not take an artist key's play, and album-artist copies split by album
when no artist key exists; a losing copy gives up its count, a higher local
count stays, a retag that unlinks keeps its count; a library on fold 8 relinks
and counts once.

In `scan/mod.rs`: removing a copy hands on to the remaining copy on its album.

## Verification

- The *Two Hunters* copies of `I Will Lay Down My Bones…` and `Cleansing` show
  their plays; the *Live at Roadburn 2008* copies show 0 and 4 (the Vinyl
  plays).
- Isis *Panopticon* shows its plays on the album copy.
- Relaunching after the version-9 pass moves nothing, and a no-op scan moves
  nothing.
