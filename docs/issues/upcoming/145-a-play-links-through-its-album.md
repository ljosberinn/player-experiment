# 145 — A play links through its album when last.fm has the wrong artist

*Heard, never owned* lists `mods — Franz Josef Degenhardt` (63 plays). The file
is `Disko Degenhardt — Mods`, album *Harmonie Hurensohn 2*. last.fm merges the
rapper into the folk singer, so none of the scrobbles carries an artist that any
file does, and neither the artist key nor the album-artist key of
[135](../done/135-a-play-links-through-the-album-artist.md) can link them. Of
708 plays credited to `Franz Josef Degenhardt`, 9 are linked. The albums on
those plays are the rapper's.

The album on the play is the evidence. When several titles scrobbled under one
artist on one album all land on the same library artist's copy of that album,
the scrobbled artist is that library artist's, at least for that album.

## Fix

Add a third tier to `resolve`, after the artist and album-artist keys. It only
touches plays whose `match_key` finds no track, so no link that is right today
moves.

1. Index tracks by (`fold_album(album)`, `normalize(title)`), and record each
   track's library artist (album artist, else artist).
2. Group the plays that are still unlinked by (`normalize(artist)`,
   `fold_album(album)`).
3. A group is accepted when **≥2 distinct titles** hit an index entry, and every
   hit names **one** library artist.
4. Link every play in an accepted group whose (album, title) hits. When a key
   has several tracks, `resolve`'s tiebreak picks one: present first, then the
   older id.

A play with no album gets nothing from this tier.

Compute this tier into the same assignment as the other two, not as a second
`UPDATE` after them. Otherwise the first `UPDATE` nulls the link on every run,
the second writes it back, and the guard stops making `resolve` idempotent.

`MATCH_FOLD_VERSION` goes to 4 so that `refold_if_stale` runs `resolve` once on
existing libraries. Play counts follow the links through `count` in
[136](../done/136-a-lastfm-import-sets-play-counts.md). `tracks.match_key` and
the loved set are untouched.

## Measurements

Measured on the reference log (75,175 unlinked plays), with a Python
approximation of the folds:

| Rule | Newly linked | Quality |
| --- | --- | --- |
| (album, title) hits one library artist | 4,378 | Wrong on title tracks and compilations: `Iggy Pop — Lust for Life` → Lana Del Rey, `Death In Rome — Toxicity` → System of a Down, `Isabel LaRosa — help` → The Beatles |
| Plus ≥2 distinct titles per group (**this**) | 4,063 | Every group at exactly 2 checked by hand, all correct |
| Plus ≥3 distinct titles per group | 3,875 | No wrong link removed |

Largest artist remaps under this rule: `Franz Josef Degenhardt` → `Disko
Degenhardt` / `Degenhardt` / `Detlev Disko Degenhardt` (~510), `Audio88` →
`Audio88 & Yassin`, `Ghost` → `Ghost B.C.`, `The Doors` → `Jim Morrison, Music
by The Doors`, `187 Strassenbande` → `187 Straßenbande`, `Heimataerde` →
`Heimatærde`.

## Rejected

- **last.fm `artist.getCorrection`**: last.fm is the source of the wrong
  correction, so asking it again gives the same answer.
- **MBIDs**: the play's `artist_mbid` is last.fm's, which is the wrong artist.
  78 measured 14% agreement.
- **Title only, or fuzzy artist matching**: links plays to songs that were never
  heard.

## Out of scope

`Harmonie Hurensohn II` against `2` (7 of the `mods` plays). `parts_in_arabic`
reads a numeral only after `pt`/`part`, and folding a bare trailing numeral is
its own change.

## Tests

In `plays.rs`:

- Two titles of one album under a wrong artist: both link.
- One title alone under a wrong artist: stays unlinked.
- A group whose titles hit two library artists: stays unlinked.
- A play that the artist key links is not moved by this tier.
- `resolve` run twice moves nothing the second time.

## Verification

- `mods — Franz Josef Degenhardt` on *Harmonie Hurensohn 2* leaves *Heard, never
  owned*, and `Mods` shows its last.fm plays in Plays after an import.
- `Iggy Pop — Lust for Life` stays in *Heard, never owned*.
- A library on `plays.matchFold` 3 resolves once at the next launch, and not
  again after that.
