# 173 — A play links to a near title on its own album

*Heard, never owned* lists these songs, and each one's file is on the album the
play names:

| Play | File |
| --- | --- |
| `Madrugada — Terraplane` (55) | `Terraplane '99` |
| `Burzum — Morgenrøde` (50) | `Morgenroede` |
| `Burzum — Belus' død` (46) | `Belus' Doed` |
| `Leonard Cohen — Chelsea Hotel N.2` (46) | `Chelsea Hotel #2` |
| `Nachtmystium — Ashes to Ashes (Rerecorded)` (45) | `Ashes to Ashes` on *Silencing Machine* |
| `Wolves in the Throne Room — Dia Artio` (45) | `Dea Artio` |

No fold can safely make these one key. `Terraplane`, `(Rerecorded)` and a
misspelling are all different titles. What they share is the album: the
artist and album match, and there is exactly one title on that album close to
the play's.

## Fix

Add a fourth tier to `resolve`, after the album tier of
[145](../done/145-a-play-links-through-its-album.md). It only touches plays that
the first three tiers leave unlinked, so no link that is right today moves.

1. Index the present tracks by (`normalize(artist)` or
   `normalize(album_artist)`, `fold_album(album)`).
2. For each unlinked play with an album, take the tracks under its
   (`normalize(artist)`, `fold_album(album)`). Score each track by the
   similarity of `normalize(title)` on both sides.
3. Link to the best track when:
   - its score is ≥ 0.85,
   - it beats the second-best track on that album by ≥ 0.1, and
   - when one title is the other plus extra words, none of those words is a
     version word: `live`, `remix`, `mix`, `skit`, `orchestral`, `acoustic`,
     `demo`, `instrumental`, `edit`, `version`, `intro`, `outro`, `reprise`,
     `interlude`, `unplugged`, `radio`, `extended`, `dub`, `part`, `pt`, or a
     numeral from 2 to 5 or ii to v.

The similarity is a normalized Levenshtein ratio, written in-house the way
[167](../done/167-own-the-chart-maths.md) owns its maths. The measurements
below used Python's `difflib` ratio. Measure the thresholds again with the Rust
metric on a copy of the library before landing this.

Compute this tier into the per-play assignment of 145, not as a later
`UPDATE`, so that `resolve` stays idempotent. Bump `MATCH_FOLD_VERSION`, so
that existing libraries resolve once.

Stack this on [172](../done/172-and-and-a-bare-featuring-credit.md). The measurements
assume that fold, and `Gods & Monsters` links there instead.

## Measurements

Measured on a copy of the library, after the folds of 170 to 172: 395 spellings
and 1,813 plays gain a file. The guard rejects 43 spellings (145 plays).

- **Right, and the guard rejects them**: `King Dude — My Everlasting Life` →
  `… II`, `Absztrakkt — Back in the daysz` → `… (skit)`, `Jex Thoth — Equinox
  Suite: …` → `Equinox Suite, Pt. 1: …`.
- **Right, and the guard over-rejects them**: `Rome — … - Live` on a live album,
  whose files carry no `Live`.
- **Doubtful, between 0.85 and 0.92**: `Drowning the Light — Apparitions of
  death` → `… of Decay`, `Forthcoming Fire — On My Way Back Home (New Version)`
  → `My Way Back Home (Tied Version)`, `Kool Savas — Nichts Bleibt Mehr` →
  `Nichts bleibt mir`. That is about 3 of 45 in the band, checked by hand. Of
  the rest, the hand check found the 0.85–0.92 band right, for example `Interpol
  — The Heinrich Maneuver` → `Heinrich Maneuver` and `True Widow — Fourth Teeth`
  → `Four Teeth`.
- **With the threshold at 0.9 instead of 0.85**, before the guard: 348
  spellings and 1,540 plays, against 453 and 2,053.

## Out of scope

- A play with no album. Without an album, a near title is a guess.
- Plays whose album is not in the library under that artist.

## Tests

In `plays.rs`:

- `Terraplane` on *Industrial Silence* links to `Terraplane '99` on it.
- `Dia Artio` links to `Dea Artio`.
- `My Everlasting Life` does not link to `My Everlasting Life II`, and
  `Unsachlich` does not link to `Unsachlich (Skit)`.
- A play whose two nearest titles score within 0.1 of each other stays
  unlinked.
- The same title on another album of the artist does not link.
- `resolve` run twice moves nothing the second time.

## Verification

- The six songs above are gone from *Heard, never owned*.
- `Ashes to Ashes (Rerecorded)` links to the *Silencing Machine* file, not the
  *Demise* one.
