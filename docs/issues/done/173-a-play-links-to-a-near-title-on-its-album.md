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

A fourth tier in `resolve`, after the album tier of
[145](145-a-play-links-through-its-album.md). It only touches plays that the
first three tiers leave unlinked, so no link that is right today moves.

1. Index every track, present or not, by (`normalize(artist)` or
   `normalize(album_artist)`, `fold_album(album)`), one entry per distinct
   `normalize(title)` under the tiebreak of `play_keys`: present first, then
   the lower id. An unplugged drive keeps the link, as it does for a key.
2. For each unlinked play with an album, take the titles under its
   (`normalize(artist)`, `fold_album(album)`) and score each against
   `normalize(title)`.
3. Link to the best title when:
   - its score is ≥ 0.85,
   - it beats the second-best title on that album by ≥ 0.1, and
   - when one title is the other plus extra words, none of those words is a
     version word: `live`, `remix`, `mix`, `skit`, `orchestral`, `acoustic`,
     `demo`, `instrumental`, `edit`, `version`, `intro`, `outro`, `reprise`,
     `interlude`, `unplugged`, `radio`, `extended`, `dub`, `part`, `pt`, or a
     numeral from 2 to 5 or ii to v.

The score is the longest common subsequence over both titles' length, which is
Python's `difflib` ratio. Levenshtein over the longer title puts `Terraplane`
against `Terraplane 99` at 0.77.

The links go into the album tier's temporary table, so the one `UPDATE` covers
them and `resolve` stays idempotent. `MATCH_FOLD_VERSION` 8.

## Measurements

On a copy of the library, after the folds of 170 to 172: 404 spellings and
1,838 plays gain a file. The guard rejects 56 spellings (174 plays), and the
margin 71 (287). At 0.9 instead of 0.85, before the guard: 356 spellings and
1,535 plays, against 460 and 2,012.

- **Right, and the guard rejects them**: `King Dude — My Everlasting Life` →
  `… II`, `Absztrakkt — Back in the daysz` → `… (skit)`, `Jex Thoth — Equinox
  Suite: …` → `Equinox Suite, Pt. 1: …`.
- **Right, and the guard over-rejects them**: `Rome — … - Live` on a live album,
  whose files carry no `Live`.
- **Doubtful, in the 110 spellings between 0.85 and 0.92**: `Drowning the Light —
  Apparitions of death` → `… of Decay`, `Forthcoming Fire — On My Way Back Home
  (New Version)` → `My Way Back Home (Tied Version)`, `Kool Savas — Nichts
  Bleibt Mehr` → `Nichts bleibt mir`. The rest of the band reads right, for
  example `Interpol — The Heinrich Maneuver` → `Heinrich Maneuver`.
- **`Ashes to Ashes (Rerecorded)` stays unlinked**: 0.72 against `Ashes to
  Ashes`.

## Out of scope

- A play with no album. Without an album, a near title is a guess.
- Plays whose album is not in the library under that artist.

## Verification

- `Terraplane`, `Morgenrøde`, `Belus' død`, `Chelsea Hotel N.2` and `Dia Artio`
  are gone from *Heard, never owned*.
