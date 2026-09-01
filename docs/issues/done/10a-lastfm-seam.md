# 10a — the last.fm seam and the signature

The first of four ([plans/lastfm.md](../../plans/lastfm.md)). No UI, no
credentials, and nothing that runs in the app yet: `src-tauri/src/lastfm/`
gains the boundary everything above it will be tested against, plus the one
piece of arithmetic with a wrong answer that looks right.

- `transport.rs` — the `Transport` trait, the `reqwest::blocking`
  implementation, the fake, and `TransportError`.
- `sign.rs` — `api_sig`, pure.
- `mod.rs` — the error taxonomy, and `parse`, which turns a body into a value
  or into the error it describes.
- `audio/engine.rs` — `Event::Played` now carries the timestamp the track
  started.

## Decisions

**An HTTP status is not how last.fm reports errors**, so `Transport::post`
hands a 4xx body upwards as `Ok` exactly like a 200 — that is where "invalid
session key" arrives — and `TransportError` covers only the cases with no
envelope to read: no answer at all, or a 5xx gateway page. The plan asked for
"non-200 → the right error"; splitting it at 5xx rather than at 200 is what
keeps a nine classifiable.

**Only 11, 16 and 29 are retried.** 29 is not on last.fm's own retry list,
which is an omission rather than a claim — no request budget is published and
the condition is plainly temporary. Everything else is a malformed request, and
a body that will not parse now will not parse later either.

**`Event::Played` records the start time rather than deriving it.**
`now - position_ms` is wrong for any track that was paused or seeked, and both
are ordinary. The engine takes an injectable clock so the difference between
"when it started" and "when it crossed the halfway mark" is testable at all —
with a real clock both fall in the same second.

**The error taxonomy and `parse` live in `mod.rs`**, not in a file of their own:
`auth`, the service and the queue all share them, and the plan's file list has
nowhere else to put them.

## Tests

- `sign.rs` — the signing base asserted as a string, not just its md5, because
  an md5 of the wrong input tells you only *that* something is wrong. Includes
  the mandatory vector: `artist[10]` sorts before `artist[1]`, and `format` and
  `callback` are excluded.
- `mod.rs` — the error envelope, the legacy `text/plain` 200 (`FAILED Incorrect
  protocol version…`), an empty body, and which codes are worth retrying.
- `transport.rs` — the fake's script and call log, and three `wiremock` round
  trips on 127.0.0.1: the form encoding and body, a 4xx keeping its body against
  a 5xx losing it, and a refused connection.

Each guard was proved red before being trusted: the signature tests against a
reordered sort and an empty exclusion list, the loopback test against a wrong
path.

## Not here

No credentials, and none in CI. `HttpTransport` is compiled and tested but
nothing constructs one outside a test — the app still opens no socket but the
updater's.
