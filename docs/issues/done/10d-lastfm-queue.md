# 10d — the offline queue

Last of four. A play is written down before it is sent, so a closed laptop or a
dropped connection costs nothing.

- Migration 7, `scrobble_queue`.
- `lastfm/queue.rs` — enqueue, the due batch, backoff, pruning, depth.
- `lastfm::Service::flush`, and a `Flush` job the scrobbler sends at startup.
- A queue-depth line in the Settings pane, on `lastfm://queued`.

## Decisions

**The queue is the path, not a fallback.** Every play goes in and is sent from
there, so online and offline differ only in how long a row stays. There is one
code path to get wrong instead of two.

**A play made with no account is not queued.** Keeping them would mean that
connecting an account later posted weeks of listening the user never offered —
the opposite of opt-in. This is the one place where "inert" costs something,
and it is the right cost.

**The row stores the resolved scrobble, not a track id.** A play is a
historical fact about what was on at a moment, and the row it came from can be
retagged or removed before the queue drains. Sending what the tags say today
would report something that never happened.

**Only the daily cap is worth retrying.** An ignored artist or track (codes 1,
2) and an impossible timestamp (3, 4) will be refused the same way forever, so
those rows are dropped alongside the accepted ones; code 5 is deferred. That is
what makes reading `ignoredMessage` per scrobble worth doing rather than
looking at the top-level status — which would mark a capped scrobble sent.

**A response that does not describe the batch keeps the plays.** `outcomes()`
answers `None` rather than guessing, and the queue defers. Guessing "sent"
throws plays away silently, which is the failure worth being careful about.

**Two limits, and the age one normally applies first.** last.fm rejects a play
over two weeks old, so keeping one past that means retrying into a guaranteed
rejection; twelve attempts is a backstop for a failure that time will not fix
but that this build cannot classify. Between them the queue is bounded without
a size cap.

**A failed batch stops the drain.** Being offline or rate limited will affect
the next batch too, so working through the queue failing every row in it is
pure waste — and would look like a retry storm from the other end.

**The depth line appears only when there is a backlog.** In a healthy install
that is never. A line reading "0 waiting" is a line asking to be worried about.

## Tests

- `queue.rs` — real SQLite in a `tempfile`: a play round-trips exactly,
  batching caps at fifty and comes out oldest first, a deferred row is not due
  until its backoff has passed, each failure waits longer than the last and the
  last delay repeats, a row that keeps failing is dropped, and a play older
  than two weeks never enters.
- `mod.rs` — against the fake transport, with an injected clock: a play made
  offline goes out on the next success, oldest first and in one batch; a batch
  the daily cap partly refused keeps only what was refused; a permanently
  ignored scrobble is not kept; an unreadable answer keeps the plays; a
  fifty-five-row queue drains in two calls, not one.

The partial-batch guard was proved red by ignoring the per-scrobble codes.

## Not here

Nothing prompts a flush but a play and a launch. A queue on a machine that
stops playing music sits until the next launch, which is the case it was
already going to be right about.
