# 171 — A play titled `- Remastered` links to the file

*Heard, never owned* lists `Rome — L'assassin - Remastered` (2 plays). The
file is `L'assassin`. The other 102 `L'Assassin` plays already link, so the
problem is not case. Streaming services append a remaster marker to the title,
and `match_key` keeps it. The two keys are `rome␟l assassin remastered` and
`rome␟l assassin`.

The doc comment on `without_featuring` says a remaster marker names a
different recording. It does not. A remaster is the same recording mastered
again, and the album fold's `EDITIONS` already treats it that way.

## Fix

`without_remaster` in `normalize` (`src-tauri/src/db/plays.rs`) strips a
trailing remaster marker, next to `without_featuring`, so on both sides of the
key, like the featuring credit. This runs after `decompose`, and before
`squeeze` removes the delimiters. It applies to plays and tracks both. The
library holds 14 titles like `Summer Wind (Remastered 2008)`, and those stop
matching too.

- Forms: ` - <marker>`, `(<marker>)`, `[<marker>]`. A ` - ` whose suffix holds
  a bracket is inside a run (`(Live - Remastered)`) and is not a marker.
- A marker is made only of the words `remaster`, `remastered`, `digital`,
  `digitally`, `version` and a four-digit year, and it has to contain
  `remaster` or `remastered` as a whole word. So `(remastered out-take)` and
  `(premaster)` stay. A marker with nothing before it is the title.
- The marker is stripped before the featuring credit, so that
  `Song (feat. X) - Remastered` loses both.
- `loved` keys are stored squeezed, and the delimiter is gone from them. Their
  in-place refold strips trailing marker words from the title side instead,
  never the first word. One row is affected today:
  `pink floyd␟echoes 2011 remastered version`.
- `MATCH_FOLD_VERSION` is 6.

Stacked on [170](170-letters-nfkd-cannot-fold.md).

## Measurements

On a copy of the library (71,297 unlinked plays): 359 keys and 781 plays gain
a file through the ` - ` form, and 12 keys and 13 plays through the
parenthesised form.

| Marker | Plays |
| --- | --- |
| `Remastered` | 308 |
| `Remastered YYYY` | 181 |
| `YYYY Remastered Version` | 143 |
| `YYYY Remaster` | 142 |

Largest: `Isis — So Did We - Remastered` (36), and six more Isis titles at 17
to 29 plays each.

## Tests

In `plays.rs`:

- `Song - Remastered`, `Song - Remastered 2016`, `Song - 2011 Remastered
  Version`, `Song (2016 - Remaster)` and `Song` give one key.
- `Song (remastered out-take)`, `Song (premaster)` and `Song (Live)` keep their
  own keys.
- A squeezed loved key ending in `2011 remastered version` refolds to the bare
  title.

## Verification

- `Rome — L'assassin - Remastered` and `Isis — So Did We - Remastered` are gone
  from *Heard, never owned*.
- `The 13th Floor Elevators — Fire In My Bones (remastered out-take)` keeps its
  own key.
