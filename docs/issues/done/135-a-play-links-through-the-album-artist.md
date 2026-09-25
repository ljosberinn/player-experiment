# 135 — A play links through the album artist

*Limbus* is in the library, and *Heard, never owned* still lists `Prezident —
Prometheus` (40 plays). The file is tagged artist `Prezident mit Absztrakkt`,
album artist `Prezident`. last.fm credits the primary artist and puts the guest
in the title, so the scrobble keys `prezident␟prometheus` and the file keys
`prezident mit absztrakkt␟prometheus`.

`resolve` keyed each track on `tracks.artist` alone, so a file whose artist
field carries the feature never linked. *Heard, never owned* is
`plays.track_id IS NULL` ([stats.rs:99](../../../src-tauri/src/db/stats.rs#L99)).

## Fix

`resolve` also inserts `match_key(album_artist, title)` for every track with an
album artist, after every artist key. `INSERT OR IGNORE` lets an artist key win
any key both produce, so no existing link moves. Stored keys are untouched:
`tracks.match_key` stays the artist's, so the loved set does not see the
fallback. `MATCH_FOLD_VERSION` goes to 3 so `refold_if_stale` runs `resolve`
once on existing libraries.

Measured on the reference log (237,801 plays, 78,449 unlinked):

| Option | Newly linked | Existing links moved |
| --- | --- | --- |
| Album artist key, track side (**this**) | 3,290 | 0 |
| Plus primary artist before ` feat. `/` mit `/` with `, track side | 3,325 | 0 |
| Primary artist before those and ` & `/`, `/` und `, both sides | 4,858 | 577 |

The second row adds 35 plays and a separator list to maintain. The third
merges duos into solo artists (`Hiob und Dilemma` → `Hiob`) and moves links
that are right today.

`Various Artists` gets keys too (328 tracks), and no play carries that artist,
so nothing links through them. The 324 new links whose play artist is not
inside the track artist are all label or acronym credits: `Lik` against
`Lekamen Illusionen Kallet`, and `Immediate Music` or `Two Steps from Hell`
against the composer. All correct.

Out of scope: `Prometheus feat. Absztrakkt` (10 plays), where the title has no
parentheses around the feature, and `(mit …)` in titles. Both change stored
keys and move links (57 and 24). A last.fm love on the album artist's spelling
still does not mark the file loved.

## Verification

- `Prezident — Prometheus` and `Feiern wie sie fallen` leave *Heard, never
  owned*. The file for each is tagged `Prezident mit …` / album artist `Prezident`.
- A key produced by both one track's artist and another track's album artist
  links to the artist's track.
- `resolve` run twice moves nothing the second time.
- A library on `plays.matchFold` 2 resolves once at the next launch, and not
  again after that.
