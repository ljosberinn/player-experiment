# 120 — `match_key` folds punctuation and diacritics

`plays::match_key` links a play to a file. Its `normalize` is lowercase,
collapsed whitespace and a trailing `(feat. …)` — no NFKD, no punctuation. So a
typographic apostrophe in a tag and an ASCII one in a scrobble are two songs.
`album_key`, written later, already folds both through `decompose` and
`squeeze` in the same file. `match_key` never caught up.

Over a 237,728-play library that is **9,282 unlinked plays**, 10.6% of the
87,614 that resolve to nothing. The four worst cases name the four causes:

| Artist | Cause | Unlinked | Folded |
| --- | --- | --- | --- |
| The Devil's Blood | tag `The Devil’s Blood` U+2019, scrobble U+0027 — the **artist** side, so nothing links | 2522 | 2521 |
| King Dude | titles: `Lucifer’s…`, `Death Won’t Take Me`, `I’m Cold` | 786 | 254 |
| Leonard Cohen | apostrophes, plus `Paper Thin Hotel` against `Paper-Thin Hotel` | 385 | 326 |
| The Ruins of Beverast | apostrophes, plus `Theriak - Baal - Theriak` U+002D against U+2013 | 386 | 177 |

Also folded, free: NFC against NFD in the same string (`würfelspiel`,
`ecce homo`, `monumentale schwärze` each appear twice on disk), and
`motorhead` against `motörhead`.

## The change

`normalize` becomes `squeeze(&decompose(without_featuring(trimmed)))`, both
already in [`plays.rs`](../../../src-tauri/src/db/plays.rs). `decompose`
lowercases, so the explicit `to_lowercase` goes; `squeeze` collapses whitespace,
so the `split_whitespace` join goes. Nothing new is written.

**The conservative boundary does not move.** `(Live)`, `(Remastered)` and
`(Radio Edit)` still name different recordings, and the existing tests asserting
that must keep passing. This widens punctuation and script only.

Not in scope, and both in the residual: `æ` is a codepoint NFKD does not
decompose, so `Mære` and `Maere` stay apart; and `Alu` scrobbled against
`ᚨᛚᚢ` tagged is a transliteration, not a fold. The rest of the residual is
files that are genuinely not in the library.

## The backfill

`match_key` is stored, in two places, so the code change alone links nothing.

- `plays.match_key`, under `UNIQUE INDEX idx_plays_identity(started_at,
  match_key)`. 73,467 of 237,728 rows change; **0 collide** on that index in the
  reference library, but the pass has to survive one, because a collision there
  is one song scrobbled twice in the same second and the loser should be
  dropped, not skipped.
- `lastfm_loved.match_key`, which is the whole primary key. 75 of 285 rows
  change, 0 collide, 0 empty. It is replaced wholesale on the next import, but
  between the fold and that import every one of those 75 loves reads as
  unloved, so the pass has to rewrite it rather than wait.

`plays` recomputes from its own `artist` and `title` columns. `lastfm_loved`
has no such columns and must fold the stored key in place: split on
`SEPARATOR`, fold each side, rejoin. That works because the new fold is a
refinement of the old one — but `squeeze` eats U+001F, so folding the key whole
would destroy it.

Gate it the way `regroup_if_stale` gates `regroup`: a `MATCH_FOLD` version in
`settings`, sibling to `ALBUM_FOLD`, bumped whenever the fold changes what it
folds together. A marker rather than a migration, for the reason `FOLD_VERSION`
gives — the pass reads every play, and the transaction before the window is
shown is not where that belongs. `resolve` runs after it.

## The cost

159 track-key groups that were distinct become one. 157 are the same song twice
— `la forêt de cristal` against `la foret de cristal`, `t=0` against `t = 0`,
`who by fire` against `who by fire?`. Two are real losses, both punctuation the
artist used as the title:

- Darkspace `Dark 1.1` (*Dark Space I*) and `Dark −1.−1` (*Dark Space −I*) —
  U+2212 stripped leaves `dark 1 1` for both.
- Spiritual Front `(Useless.)`, `(Useless..)` and `(Useless...)`, three tracks
  on *Nihilist Cocktails for Calypso Inferno*.

Neither loses a play. One key naming several tracks is already routine — the
album copy and the compilation copy — and `resolve`'s tiebreak picks the same
one every run. The plays land on a sibling track of the same album instead of
the right one. Accept it: refusing the fold to protect five tracks costs 9,282
plays.

## Verification

- Unit tests over the four causes above, at both `match_key` sites: the
  apostrophe pair, the dash pair, the NFC/NFD pair, and a diacritic pair.
- The existing `(Live)` / `(Remastered)` assertions still pass.
- The backfill is idempotent — running it twice moves nothing the second time,
  which is what `resolve`'s own tests assert of it.
- A collision on `idx_plays_identity` during the backfill drops one row and
  finishes, rather than aborting the pass.

`docs/knowledge/data-model.md` describes `match_key` as "lowercase, collapsed
whitespace, a trailing `(feat. …)` dropped, nothing else". Update it, and the
module header prose that says the same.

Independent of the rest of the sequence. Its own worktree.
