# 102 — Love a track from the app

Stacks on [101](101-loved-is-a-smart-playlist-field.md), which makes the loved
set worth something inside the app and inherits its one weakness: the set only
changes when a full history import runs.

`track.love` and `track.unlove` are signed session-key calls and everything
they need exists — `signed()` ([lastfm/mod.rs:73-88](src-tauri/src/lastfm/mod.rs#L73-L88)),
the stored session, the error-code branch at `:95-114`, the `Transport` seam
that keeps all of this testable without a network.

## The control

A toggle on the track, wherever a track already offers actions: the context
menu ([17](done/17-context-menus.md)), so it works on the table, on a
drill-in and on a playlist alike. The transport strip is the other candidate
and is worth adding only if loving the thing you are listening to is the
common case — decide before building, not after.

Icon-only is not a label ([conventions](../knowledge/conventions.md)):
visually-hidden text, and never colour as the only signal.

Multi-selection follows scope the way every other action does — derived from
the view, and the item says how many it will love.

## The local set is written optimistically

A love is answered in the UI before last.fm has confirmed it, by inserting the
track's `match_key` into `lastfm_loved`; an unlove deletes it. The key is
`plays::match_key` over the track's own artist and title, which is the same
function the import uses, so the two agree by construction.

If the call fails the row goes back. **This failure is reported**: the user
asked for it, which is the line [conventions](../knowledge/conventions.md)
draws. No queue — `scrobble_queue` exists because a scrobble has a timestamp
that expires and a play that already happened; a love is a present-tense
preference, and retrying one from three days ago is not obviously right.

A track whose artist or title is empty has no key
([plays.rs:45-52](src-tauri/src/db/plays.rs#L45-L52)) and cannot be loved. The
control is disabled, and says so.

## Not connected, and no key

Disabled with the reason, as the field in 101 is. The two share the condition
and should share how they say it.

## The set still drifts

Loving elsewhere — the website, a phone — still does not reach here until the
next full import. This closes the half that is in reach; a standalone refresh
calling `Import::loved` on its own is a small follow-up if the drift turns out
to matter in use. `Import::loved` already takes only a connection and a
username.

## Testing

Rust, against the fake transport: a love inserts the key and calls
`track.love` with the signed parameter set; an unlove deletes it and calls
`track.unlove`; a transport error restores the previous state and surfaces;
error 9 forgets the session the way the rest of the module does; a track with
no artist is refused before any call. One test that loving a track twice is
idempotent in `lastfm_loved`, because `PRIMARY KEY` is the only thing stopping
it and an optimistic write is exactly where a duplicate would come from.

Frontend: the control's disabled states — no key, not connected, no key
derivable — each asserted with its reason, and the optimistic toggle reverting
on a rejected call.
