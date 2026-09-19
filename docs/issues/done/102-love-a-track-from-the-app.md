# 102 — Love a track from the app

Stacks on [101](101-loved-is-a-smart-playlist-field.md), which makes the loved
set worth something inside the app and inherits its one weakness: the set only
changes when a full history import runs.

`track.love` and `track.unlove` are signed session-key calls and everything
they need existed already — `signed()`, the stored session, the error-code
branch, the `Transport` seam that keeps all of this testable without a network.

## The control

A toggle on the track, in the context menu ([17](17-context-menus.md)), so it
works on the table, on a drill-in and on a playlist alike. `rowMenuItems`
builds it, so the Edit menu carries it too.

**No transport-strip heart.** The other candidate, and it was weighed before
building: loving what is playing is not common enough to earn a permanent
control in the strip, and the strip would have to subscribe to the loved set
to draw one.

Multi-selection follows scope the way every other action does, and the entry
says how many it will love. A mixed selection reads as not loved: Love is the
act that makes it agree, and Unlove on it would undo loves the user never made
here.

## The window holds the loved set

`rowMenuItems` is pure and synchronous, so the entry has to know whether the
selection is loved the instant the menu opens. `lastfm_loved_tracks` answers
with the whole set — 215 rows on the real library, 53 ms — and
`useLastfmStore.loved` holds it. `useLoveEntry` is the one place both menus
read it, subscribed rather than `getState()`: a menu opened after a love has
to say Unlove.

A `loved` column on `Track` was the alternative and was rejected: the
membership test is a semi-join over `plays` with no index leading on
`match_key`, and the virtualized table pages on every scroll.

## The local set is written optimistically

A love is answered in `lastfm_loved` before last.fm has confirmed it, and the
row goes back if the call fails. `db::loved` owns those writes; the key is
`plays::match_key` over the track's own artist and title, the same function
the import uses, so the two agree by construction.

**The failure is reported**: the user asked for it, which is the line
[conventions](../../knowledge/conventions.md) draws. No queue — `scrobble_queue`
exists because a scrobble has a timestamp that expires and a play that already
happened; a love is a present-tense preference.

A selection is one request per song, and a refusal stops the rest rather than
working through them: what refused one call will refuse the next, and the
songs already done stay done. The command answers with the set as it now
stands, so the window never has to work out that two rows sharing a
`match_key` are loved together.

## What greys the entry, and what hides it

- **No API key in the build** — absent. There is no account to connect and no
  question the entry would answer, the way the lookup entries are absent
  rather than greyed when the tag is empty.
- **No account connected** — greyed, `Needs a last.fm account`.
- **No artist or title** — greyed, `No artist and title`. `match_key` has no
  key for such a song, so the love could be sent but never remembered.

`MenuItem.hint` is new and carries the reason. A menu entry cannot hold the
`<p>` the smart-playlist editor uses, and a disabled entry that does not say
what would un-grey it leaves the user guessing.

A row the table no longer caches counts as keyed: a selection outlives the
pages behind it, and greying the entry because a page was evicted would make
the menu depend on how far the user has scrolled. The backend refuses an
unkeyable selection whole.

## The set still drifts

Loving elsewhere — the website, a phone — still does not reach here until the
next full import. This closes the half that was in reach; a standalone refresh
calling `Import::loved` on its own is a small follow-up if the drift turns out
to matter in use.

## Changes

- `db/loved.rs`: the table's whole vocabulary — `MEMBERS` (moved out of
  `smart`), `tracks`, `remember`, `forget`, `held`, `replace` (moved out of
  `import`).
- `lastfm/love.rs`: the signed calls, the optimistic write and its rollback.
- `commands/`: `lastfm_loved_tracks`, `lastfm_love`.
- `components/ui/ContextMenu.tsx`: `MenuItem.hint`, and the explicit
  `aria-label` that keeps a hinted entry from being announced as one word.
- `features/lastfm/loveEntry.ts`, `store.ts`: the set and the toggle.
- `features/library/rowMenu.ts`: the entry and `lovingFor`.
