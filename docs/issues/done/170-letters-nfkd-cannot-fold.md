# 170 — A play folds ß, ø, æ, ð, þ and runes into the file's spelling

*Heard, never owned* lists `Von Thronstahl — Ganz In Weiss Und Ganz In Eisen`
(72 plays). The file is tagged `Ganz in Weiß und ganz in Eisen`. `decompose`
lowercases and applies NFKD, and neither of those rewrites `ß`. The two keys
are `… weiss …` and `… weiß …`.

`ø`, `æ`, `œ`, `ð`, `þ`, `ł` and `đ` fail the same way. They are letters in
their own right, not a base letter plus a combining mark, so NFKD leaves them
alone. `Burzum — Heidr` does not link to `Heiðr`, and `Troll — Mørkets Skoger`
does not link to `Morkets`.

`The Ruins of Beverast — Alu` (52 plays) is tagged in Elder Futhark as `ᚨᛚᚢ`.

## Fix

In `decompose` (`src-tauri/src/db/plays.rs`), after the combining marks are
stripped, map `ß`→`ss`, `æ`→`ae`, `œ`→`oe`, `ø`→`o`, `ð`→`d`, `þ`→`th`,
`ł`→`l` and `đ`→`d` (`spelled`). Also map the 24 Elder Futhark runes, which
are scattered through the Runic block (U+16A0–U+16F8), to their standard Latin
transliteration. The block's punctuation (`᛫`) is not alphanumeric, so
`squeeze` already splits words on it. `match_key` and `album_key` both pick
this up.

- `MATCH_FOLD_VERSION` 4→5, so that `refold` rewrites the stored keys once.
  `loved` refolds in place, which works because the new fold refines the old
  one.
- `FOLD_VERSION` 1→2, so that the album groups regroup once.
- Update the `decompose` and `match_key` doc comments.

A plain character map, not Unicode full case folding. Case folding covers `ß`
and none of the others.

`ø` maps to `o` and not to `oe`. `ø`→`o` gains 22 spellings, and `ø`→`oe`
gains 3 while losing those. Spellings in `oe` (`Morgenroede`, `Belus' Doed`),
and the German `ae`/`oe`/`ue` spellings (`Praetorianer`), link through the
album in [173](../upcoming/173-a-play-links-to-a-near-title-on-its-album.md).

## Measurements

On a copy of the library (71,297 unlinked plays), with a Python approximation
of the fold:

| Letters | Unlinked spellings that now match a file | Plays |
| --- | --- | --- |
| `ß` | 15 | 187 |
| `ø æ œ ð þ ł đ` | 22 | 80 |
| Runes | 4 | 67 |

Largest: `Von Thronstahl — Ganz In Weiss…` (72), `The Ruins of Beverast —
Alu` (52), `Nocte Obducta — Es fließe Blut` (35), `Prezident — Es heißt, dass
sie heiß ist` (19).

13 pairs of library keys merge. Every pair is the same song filed twice
(`Rammstein — Weißes Fleisch` / `Weisses Fleisch`, `Windir — Likbør` /
`Likbor`). `resolve`'s tiebreak picks one file: present first, then the older
id.

## Out of scope

- Cyrillic, Hangul and other scripts. Matching those means transliterating a
  whole script, where the runes are 24 letters.
- `library::layout::fold`. It compares filesystem paths, and has to fold the way
  the filesystem does.

## Tests

In `plays.rs`:

- `Weiß`/`Weiss`, `Heiðr`/`Heidr`, `Æra`/`Aera`, `Mørkets`/`Morkets`,
  `ᚨᛚᚢ`/`Alu` and a rune-punctuated title give one `match_key`.
- `Große Freiheit`/`Grosse Freiheit` give one `album_key`.
- A library on `plays.matchFold` 4 refolds once, links the play and refolds the
  loved key.

## Verification

- `Ganz In Weiss Und Ganz In Eisen` and `Alu` are gone from *Heard, never
  owned*. The `Ganz in Weiß` file shows 72 last.fm plays.
- `Burzum — Heidr` links to `Heiðr`.
