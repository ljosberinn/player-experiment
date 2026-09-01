# 10 — last.fm scrobbling

Decided: go. The plan is [plans/lastfm.md](../../plans/lastfm.md); read it before
10a, since two of its original recommendations were reversed.

The product's first outbound network dependency. Opt-in, off by default, and
inert with no account connected — no request, no code-path change.

Four PRs, each useful alone:

- **10a** — `transport.rs` (the trait, synchronous), `sign.rs` (the `api_sig`
  md5), the fake transport, the error taxonomy. No UI, no network, no
  credentials. Also adds a start timestamp to `Event::Played`, which today
  carries only a track id.
- **10b** — `auth.rs`: `auth.getToken`, the browser trip, the `auth.getSession`
  poll, and a settings pane with Connect/Disconnect and a status line.
- **10c** — `rules.rs` and the service, wired to the existing `Event::Played`.
- **10d** — `queue.rs`: the offline queue, backoff, batching, a queue-depth line.

Constraints that are already decided:

- **The browser token flow, not in-app credentials.** The password never enters
  the process, so there is nothing to keep out of logs or `crash.rs`.
- **The session key is stored unencrypted**, as one `settings` row, documented as
  unencrypted. No DPAPI, so the crate keeps `unsafe_code = "forbid"`. A test
  asserts the key is absent from an export (`settings::EXPORTABLE` is an
  allowlist).
- **`format=json`**, so no XML parser. HTTP 200 does not mean success, and one
  malformed request returns a legacy `text/plain` 200 the parser must survive.
- **50% of the track is the sole scrobble trigger** — last.fm's 4-minute cap is
  not adopted, so an hour-long mix scrobbles at 30 minutes. This is the same
  constant play counts use (`PLAYED_FRACTION`); the two must not drift.
- A 30-second floor is worth adding; it costs nothing and matches other clients.
- Each repeat loop is a play, so each loop scrobbles.
- Retry only errors 11, 16 and 29; re-authenticate on 9; never retry anything
  else, and never retry now-playing. The daily cap arrives as an
  `ignoredMessage` inside a successful response, so a batch can be partly
  rejected.
- One loopback `wiremock` test covers `transport.rs`. No credentials in CI.

The Account menu already ships empty and disabled for this
(`src/features/shell/menus.ts`).

Done when: a connected account scrobbles a played track, an unconnected one
sends nothing, and the guard tests above are green.
