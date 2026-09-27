# 172 — `&` folds into `and`, and a bare `feat.` credit drops

*Heard, never owned* lists two songs whose files are in the library:

- `Lana Del Rey — Gods & Monsters` (42 plays). The file is `Gods and
  Monsters`. `squeeze` deletes the `&`, so the keys are `gods monsters` and
  `gods and monsters`.
- `Casper — In deinen Armen feat. Amaris` (45 plays). The file is `Casper feat.
  Amaris — In deinen Armen`, with album artist `Casper`. `without_featuring`
  drops a credit only inside parentheses.

## Fix

In `normalize` (`src-tauri/src/db/plays.rs`):

- Before `squeeze`, replace `&` with ` and `.
- On both sides, drop a bare credit: a whole, whitespace-led `feat.`, `feat`,
  `featuring` or `ft.` outside brackets, up to the next bracket or ` - `. What
  follows stays, so `Song feat. X (Live)` is `Song (Live)`. `with` and a bare
  `ft` stay, because they occur in ordinary titles.
- In `refold`, a loved key that was a track's stored key moves to the track's
  new key. The stored key has lost the `&`, so folding it again cannot get
  there. A key two tracks shared and the fold parts is loved under both.
- Bump `MATCH_FOLD_VERSION` to 7.

Stacked on [171](171-a-remaster-marker-is-the-same-song.md).

## Measurements

On a copy of the library (71,297 unlinked plays):

| Rule | Spellings | Plays |
| --- | --- | --- |
| `&` → `and` | 47 | 198 |
| Bare `feat.` dropped from title and artist | 138 | 1,125 |

Largest: `Casper — In deinen Armen feat. Amaris` (45), `Lana Del Rey — Gods &
Monsters` (39), `Yoav feat. Emily Browning — Where Is My Mind?` (38), and
`Morlockk Dilemma`'s `feat.` titles (29 to 37 plays each).

## Tests

In `plays.rs`:

- `Gods & Monsters`/`Gods and Monsters` give one key.
- `Casper — In deinen Armen feat. Amaris` and `Casper feat. Amaris — In deinen
  Armen` give one key.
- A bracket or ` - ` after the credit stays.
- `Dance with Me`, `Left ft Right`, `Creature Feature` and a credit inside a
  bracketed run keep their words.
- A loved `simon garfunkel…` key is loved under both `Simon & Garfunkel` and
  `Simon Garfunkel` tracks after `refold`.

## Verification

- `Gods & Monsters` and `In deinen Armen feat. Amaris` are gone from *Heard,
  never owned*.
- A song loved before the update with `&` in its artist or title is still
  loved.
