# 10 — last.fm scrobbling

**Blocked on a go/no-go.** The plan is written:
[plans/lastfm.md](../../plans/lastfm.md), including the four questions that
decide whether this happens at all. Do not start 10a before they are answered.

The product's first outbound network dependency. Opt-in, off by default, and
inert with no account connected — no request, no code-path change.

Four PRs, each useful alone:

- **10a** — `transport.rs` (the trait), `sign.rs` (the `api_sig` md5), the fake
  transport, the error taxonomy. No UI, no network, no credentials.
- **10b** — `auth.rs` and `secret.rs`: username and password fields, one
  `auth.getMobileSession`, the sealed session key, a settings pane with
  Connect/Disconnect and a status line.
- **10c** — `rules.rs` and the service, wired to the existing `Event::Played`.
- **10d** — `queue.rs`: the offline queue, backoff, batching, a queue-depth line.

Constraints that are already decided:

- The **password is never stored**. Held in one `String`, sent, dropped — and it
  must never reach a log line or a panic message, because `crash.rs` writes the
  panic payload verbatim.
- Only the session key persists, sealed with DPAPI, in `settings`. A test asserts
  it is absent from an export (`settings::EXPORTABLE` is an allowlist) and absent
  from a crash report.
- **50% of the track is the sole scrobble trigger** — last.fm's 4-minute cap is
  not adopted, so an hour-long mix scrobbles at 30 minutes. This is the same
  constant play counts use (`PLAYED_FRACTION`); the two must not drift.
- A 30-second floor is worth adding; it costs nothing and matches other clients.
- Each repeat loop is a play, so each loop scrobbles.
- No credentials in CI, and no test that would use one.

The Account menu already ships empty and disabled for this
(`src/features/shell/menus.ts`).

Done when: a connected account scrobbles a played track, an unconnected one
sends nothing, and the guard tests above are green.
