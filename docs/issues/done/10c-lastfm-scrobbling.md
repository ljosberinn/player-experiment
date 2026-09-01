# 10c — now playing, and scrobbles

Third of four. A connected account now scrobbles; an unconnected one still
sends nothing.

- `lastfm/rules.rs` — whether a play is worth sending, and what to send. Pure.
- `lastfm/mod.rs` — `Service`, which owns the transport, and `Scrobbler`, the
  thread it runs on.
- `audio/engine.rs` — `Event::NowPlaying`, emitted once per load after five
  seconds.

## Decisions

**The 50% trigger stays in the engine; the 30-second floor is in `rules`.**
`PLAYED_FRACTION` is behind play counts and scrobbling alike, so the two can
never disagree about what "played" means. last.fm's four-minute cap is
deliberately not adopted — an hour-long mix scrobbles at thirty minutes —
because adopting it would be a second definition of the same word. The floor
has no such conflict.

**A scrobble runs on its own thread**, the same shape as `audio::Player`. The
player thread produces `Played`, and it is the one thread in the app that must
not wait on a socket, so it hands over a track id and moves on. The thread
resolves the row and applies the rules itself.

**No thread at all in a build with no key.** `Scrobbler::start` returns
`Option`, so "no code-path change" is literal rather than merely quiet: no
channel, no thread, and nothing on the played path that was not there before.

**Now playing is announced after five seconds, and never retried.** Immediately
would announce every track someone skips past, and each announcement is a
request. Retrying it would describe a moment that has passed, which is why
last.fm says not to.

**A dead session key is not a failed request.** Error 9 is the user having
revoked the application, so the service forgets the key and reports it on
`lastfm://disconnected`; the store clears the account and the pane says why.
Being offline is emphatically *not* that — a dropped connection leaves the
account alone, or a network hiccup would log the user out.

**Array notation even for one scrobble**, so the single and the batched path
are the same request shape, and so the ASCII ordering `sign` has to get right is
exercised by every scrobble rather than only by a queue flush.

**`accepted()` reads the response per scrobble.** An `ok` status does not mean
every scrobble landed — the daily cap arrives as an `ignoredMessage` on an
individual scrobble inside an otherwise successful response. It answers `None`
when the response does not describe the batch at all, which is the case where
assuming success would throw plays away silently. 10d is what acts on that.

## Tests

- `rules.rs` — the boundaries: the floor is exact at 30 000ms, both mandatory
  tags are mandatory and are trimmed, a blank album is absent rather than
  empty, an hour-long mix still counts, a play with no timestamp does not.
- `mod.rs` — against the fake transport: an unconnected install never reaches
  it at all; a scrobble carries the start time in seconds and the indexed
  parameters; now playing carries no timestamp; error 9 forgets the key and
  reports once; a refused connection, a rate limit, a 16 and the legacy
  `text/plain` 200 all leave the account connected; a partly-ignored batch is
  read per scrobble; a response that does not describe the batch answers
  nothing rather than "all accepted".
- `engine.rs` — announced once after five seconds, never while skipping through
  a queue, again on each repeat loop, and regardless of the 30-second floor,
  which is not the engine's business.
- `store.test.ts` — a rejection lands mid-trip and stops the poll.

## Not here

No offline queue. A scrobble that fails is lost; 10d is the fix, and is last on
purpose because it is the part most likely to be reshaped by what the API
actually does.
