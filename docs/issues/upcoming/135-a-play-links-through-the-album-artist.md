# 135 — A play links through the album artist

*Limbus* is in the library, and *Heard, never owned* still lists `Prezident —
Prometheus` (40 plays). The file is tagged artist `Prezident mit Absztrakkt`,
album artist `Prezident`. last.fm credits the primary artist and puts the guest
in the title, so the scrobble keys `prezident␟prometheus` and the file keys
`prezident mit absztrakkt␟prometheus`.

`resolve` keys each track on `tracks.artist` alone
([plays.rs:424](../../../src-tauri/src/db/plays.rs#L424)), so a file whose
artist field carries the feature never links. The panel is `owned: false`,
which is `plays.track_id IS NULL`
([stats.rs:97](../../../src-tauri/src/db/stats.rs#L97)).

## Fix

In `resolve`, a second pass inserts `match_key(album_artist, title)` for every
track with an album artist, after every artist key. `INSERT OR IGNORE` then
lets an artist key win any key both produce, so no existing link moves. Only
the track side changes: stored keys stay as they are and nothing needs
rewriting. Bump `MATCH_FOLD_VERSION`
([plays.rs:634](../../../src-tauri/src/db/plays.rs#L634)) so `refold_if_stale`
runs `resolve` once on existing libraries.

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
keys and move links (57 and 24).

`data-model.md` says "`resolve` is the key alone". Add the album artist fallback
there.

## Verification

- `Prezident — Prometheus` and `Feiern wie sie fallen` leave *Heard, never
  owned*. The file for each is tagged `Prezident mit …` / album artist `Prezident`.
- A key produced by both one track's artist and another track's album artist
  links to the artist's track.
- `resolve` run twice moves nothing the second time.
- A library already on the current `plays.matchFold` resolves once at the next
  launch, and not again after that.
