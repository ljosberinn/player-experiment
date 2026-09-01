# last.fm scrobbling — plan

**Decided 2026-09-01. Go.** Opt-in, off by default, inert with no account
connected. The issue is [10](../issues/upcoming/10-lastfm-scrobbling.md).

Two of this plan's own recommendations were reversed at the go/no-go, both on
evidence gathered from last.fm's docs and from what other open-source clients
actually do. The original reasoning is kept below each reversal, because it is
the part worth not repeating.

## Authentication: the browser token flow

**Reversal.** The draft chose in-app username and password via
`auth.getMobileSession`, on the grounds "no browser trip, no keychain". Both
halves were wrong: the desktop flow needs no local HTTP listener, and neither
flow needs a keychain, because both end with the same non-expiring session key
needing the same storage. Auth flow and key storage are orthogonal, so the flow
that never touches a password wins for free.

The flow, per [desktopauth](https://www.last.fm/api/desktopauth) and
[authspec §4](https://www.last.fm/api/authspec):

1. `auth.getToken` → an unauthorized token, valid 60 minutes, single use.
2. Open `https://www.last.fm/api/auth/?api_key=…&token=…` in the user's browser.
   `tauri-plugin-opener` already ships.
3. Poll `auth.getSession` with that token. Error **14** "token has not been
   authorized" is the not-yet signal; **15** is expiry, **4** is a bad token.

**No callback URL and no local listener.** `desktopauth` §1 mentions a callback,
but no step in the desktop flow uses one — that is a genuine contradiction in
last.fm's own text, and the callback belongs to the *web* flow
([webauth](https://www.last.fm/api/webauth)). Strawberry and Clementine do run a
`LocalRedirectServer` anyway; Amarok, Audacious, cmusfm and musikcube do not. We
do not.

**The password never enters the process.** So the draft's hardest constraint —
keeping the password out of every log line and out of `crash.rs`, which writes
the panic payload verbatim — does not exist. Nothing to enforce, nothing to test,
nothing to get wrong later.

### Why not the hashed-password form

`auth.getMobileSession` documents `password` as **"The password in plain text"**.
A deprecated `authToken = md5(username + md5(password))` is still described on
that page, with "support for authToken will be removed in the future".

It would buy nothing even if it were supported. The formula has **no timestamp,
nonce or server challenge** — it is a pure function of username and password, so
it is a static bearer credential that mints fresh session keys indefinitely.
Storing it is storing the password with extra steps. (The dead Submissions
Protocol 1.2.1 token, `md5(md5(password) + timestamp)`, *was* timestamp-bound;
2.0's is not.) Client-side hashing renames a secret, it does not reduce one.

Whether last.fm still accepts `authToken` in 2026 could not be verified without
a signing key. Deprecated and unverifiable is reason enough.

## The session key at rest: a plain row, labelled as one

**Reversal.** The draft recommended DPAPI. The key is stored **unencrypted**, as
one row in the `settings` table, documented as unencrypted.

Three things decided it:

- **DPAPI costs a permanent guarantee.** `unsafe_code = "forbid"` in
  `src-tauri/Cargo.toml` cannot be overridden locally — `forbid` beats any inner
  `allow`. DPAPI means relaxing the whole crate to `deny` and marking one file
  `#[expect(unsafe_code)]`. That is a project-wide, permanent reduction in a
  static guarantee, bought to protect a scrobble-scoped token.
- **The stored secret is no longer password-adjacent.** Under the browser flow it
  grants scrobbling on one account and nothing else, and the user revokes it from
  last.fm's own settings screen without changing their password.
- **Nobody does otherwise.** Of eleven surveyed open-source clients that
  authenticate to last.fm, **eight** keep the session key in an unencrypted
  app-owned config file, **one** uses an OS credential store, and **zero** use an
  app-level encryption scheme. Amarok moved *away* from KWallet in
  [588d8cef9d](https://github.com/KDE/amarok/commit/588d8cef9d) (2024) — "no new
  data is saved to kwallet in any case […] Thus also avoids any KWallet related
  bugs" — closing [KDE bug 414826](https://bugs.kde.org/show_bug.cgi?id=414826),
  where kwalletd failed to start and the app offered plaintext instead. The
  direction of travel is toward the plain file, once the credential stops being a
  password.

So `secret.rs` is **not built**, and the crate keeps forbidding unsafe.

The draft's warning stands and is the reason this is labelled rather than
obscured: **what must not be built is encryption under a constant compiled into
the binary** — SQLCipher with a baked-in key included. It reads like protection
in review and is worth about as much as plaintext, with the added cost that
nobody can tell at a glance how exposed the secret is. If it is unencrypted, it
must look unencrypted.

`settings` is a SQLite key/value table, not a config file, so "plain row" and
"plain config line" are the same exposure in a different container. The database
is not a protection boundary: `rusqlite` is built `["bundled", "backup"]`, no
SQLCipher, so anything can open the file.

**Export exclusion is already free.** `settings::EXPORTABLE` is an allowlist
written for this exact case before the feature existed, so a new credential key
is excluded by default. One assertion covers it.

**A key that stops working is normal**, and the response is to forget it and ask
the user to connect again. Error **9** "Invalid session key" is the runtime
signal. Session keys have "an infinite lifetime by default"
([authspec §6.2](https://www.last.fm/api/authspec)) and are invalidated when the
user revokes the application. Whether a password change invalidates them is
undocumented — assume it might.

**The API secret** has no clean answer: a desktop client has to carry it and
anyone can extract it. Inherent to last.fm's model, accepted, not solvable here.
The mitigation is that the secret alone is useless without a session key.

## What actually leaves the machine

Say this in the UI in roughly these words.

On connect: **nothing but an API key**. Credentials are typed on last.fm's own
page, in the user's browser.

Then per track played, while scrobbling is on: artist, title, album, duration,
the timestamp the play started, and the session key. **Not** the file path, the
folder name, the library size, or anything about the machine.

**Opt-in and off by default.** A local-only player that starts talking to a
server because it was installed is a different product.

## Shape

```
src-tauri/src/lastfm/
  mod.rs        the service: what to send and when
  auth.rs       the token flow: getToken, open browser, poll getSession
  sign.rs       api_sig construction (pure)
  rules.rs      whether a play is scrobbleable (pure)
  queue.rs      the offline queue, over SQLite
  transport.rs  the trait, and the one implementation that uses the network
```

**`transport.rs` is the seam, and it is the whole testing strategy** — the same
shape as `audio::sink::AudioSink`, which is already load-bearing: the entire
playback state machine is tested against a fake sink on a runner with no sound
card. Nothing above `transport.rs` knows HTTP exists.

```rust
pub trait Transport: Send {
    /// One signed POST to the last.fm API root.
    fn post(&self, params: &[(&str, String)]) -> Result<String, TransportError>;
}
```

**The trait is synchronous**, with blocking `reqwest` on a spawned thread rather
than the Tauri async runtime — the same shape as the existing `Event::Played`
handler, which already reaches SQLite off the UI path.

## API facts that shape the code

Verified against last.fm's docs and live probes, 2026-09-01. Each of these has a
plausible wrong implementation, which is why they are written down.

- **`api_sig`**: sort params by name, concatenate `name||value` with no
  separators, append the shared secret, MD5, hex. **`format` and `callback` are
  excluded** ([authspec §8](https://www.last.fm/api/authspec)).
- **Array params sort by ASCII**, so `artist[10]` precedes `artist[1]`, and names
  are case-sensitive ([track.scrobble](https://www.last.fm/api/show/track.scrobble)).
  A mandatory `sign.rs` test vector — the easiest thing here to get quietly
  wrong.
- **`format=json` works** on `auth.getMobileSession`, `track.updateNowPlaying`
  and `track.scrobble` — verified on the error path; success-path JSON for the
  writes is unverified. **No XML parser, so no new dependency for one.** JSON
  errors use a flat shape, `{"error": 6, "message": "…"}`, not the XML
  translation ([rest](https://www.last.fm/api/rest)).
- **HTTP 200 does not mean success.** The body must be parsed regardless — last.fm
  says so outright. Worse, `track.scrobble` with too few params returns a legacy
  `text/plain` body `FAILED Incorrect protocol version …` with **HTTP 200**,
  ignoring `format` entirely. The parser must survive that.
- **Retry only 11 and 16**; re-authenticate on **9**; everything else is a
  malformed request and must not be retried
  ([scrobbling](https://www.last.fm/api/scrobbling)). Now-playing failures are
  never retried.
- **Error 29, rate limiting, is absent from that retry list** yet is plainly
  transient. Undocumented gap; treat as retry-with-backoff. No numeric rate limit
  is published.
- **The daily cap is not an error.** It arrives as `ignoredMessage` code **5**
  inside an otherwise-`ok` response, filtered per scrobble within a batch. So
  `queue.rs` must read the `accepted`/`ignored` counts and each scrobble's
  `ignoredMessage`, not just the top-level status — otherwise rejected scrobbles
  get marked sent. Codes 3 and 4 are timestamps too far past and future.
- **50 scrobbles per batch**, array notation `artist[i]`/`track[i]`/`timestamp[i]`,
  POST only.
- **Error 4 is overloaded** on `auth.getMobileSession`: both "must use POST" and
  authentication failure. Matters only if we ever use that method; noted because
  the error taxonomy is shared.
- **MD5 is a new crate.** Nothing in the tree provides it — `sha2` is there,
  `md-5` is not. One crate, same RustCrypto family.
- **`reqwest 0.13.4` already ships** transitively via `tauri-plugin-updater`, so
  it becomes a direct dependency rather than a new one.

## Testing, given that nothing may reach last.fm

| Layer | How | Network |
| --- | --- | --- |
| `sign.rs` | known vectors: params sorted by name, `format`/`callback` excluded, secret appended, MD5 — **plus the ASCII array ordering** | no |
| `rules.rs` | table-driven, incl. boundaries: longer than 30s, past half its length, has artist and title | no |
| `queue.rs` | real SQLite in a `tempfile`: enqueue, batch at 50, mark sent, retry order, permanent failure dropped rather than retried forever, **and a partially-ignored batch marking only the accepted scrobbles sent** | no |
| `mod.rs` | fake transport recording every call, canned bodies for success, rate limit, invalid key, **the legacy `text/plain` 200**, connection refused — this is where "queued offline, flushed on the next success" is asserted | no |
| `auth.rs` | fake transport: a token that is not yet authorized (error 14) polls again, an expired one surfaces, a session key is stored — and the key never appears in an export | no |
| `transport.rs` | one round trip against `wiremock` on `127.0.0.1`: request line, body encoding, non-200 → the right error | loopback |
| Frontend | the settings pane against a mocked `ipc`, like everything else | no |

The loopback row was contested and is **in**: without it, the only code in the
product that opens a socket has no coverage at all, and the fake transport would
happily pass while the real transport posted to the wrong URL with the wrong
content type. `wiremock` binds an ephemeral local port; the runner's egress is
never used.

**No credentials in CI.** A key is needed to *run* the feature, not to test it.

One guard is about this feature not leaking rather than working: the session key
is absent from an export. The draft's second guard — that the key never reaches a
crash report — is dropped along with the password: what remains is a token whose
presence in a panic message is not a password disclosure, and `EXPORTABLE`
already covers the case that matters.

## Steps

- **10a** — the seam and the signature: `transport.rs`, `sign.rs`, the fake
  transport, the error taxonomy. No UI, no network, no credentials. Decides
  whether the rest is testable.
  - Also here: **`Event::Played` must carry the timestamp the track started.**
    Today it is `Event::Played(track_id)` alone, and last.fm wants the start
    time. Deriving `now - position_ms` is wrong under pause and seek, so the
    engine records `started_at` on `start()` and carries it on the event. A
    signature change, not an afterthought.
- **10b** — connect an account: `auth.rs`, the browser trip, the poll, and a
  settings pane with Connect/Disconnect and a status line. Ends with a session
  key on the machine and nothing scrobbling.
- **10c** — now playing and scrobbles, wired to the existing `Event::Played`,
  which already fires at the right moment because it is what increments the play
  count.
- **10d** — the offline queue. Last on purpose: it only matters once the happy
  path works, and it is the part most likely to be reshaped by what the API does.

Now-playing fires after 5 seconds of continuous playback and is fire-and-forget —
it describes a moment that has passed by the time a retry lands, and last.fm says
not to retry it. A scrobble submits once past 50% with the timestamp the track
*started*.

**50% of the track is the sole trigger.** last.fm's 4-minute cap is not adopted,
so an hour-long mix scrobbles at 30 minutes. This is the same constant play counts
use (`PLAYED_FRACTION` in `audio/engine.rs`); the two must not drift. A 30-second
floor is worth adding: it costs nothing and matches other clients.

**Each repeat loop is a play**, so each loop scrobbles — consistent with what the
engine already records locally.

Double submission on a backward seek is **already impossible**: `counted` is
cleared only in `start()` and `stop()`, never in `seek()`. The draft treated this
as an open risk; the engine had solved it.

## As built

Where the code disagreed with the plan above, and why. The reasoning that
turned out to be wrong is the part worth keeping.

### 10a

**`Transport::post` splits at 5xx, not at 200.** The plan asked the loopback
test to prove "non-200 → the right error". Built that way, a 403 carrying
`{"error":9}` — which is how last.fm reports a dead session key — would have
lost its body to a status code and become unclassifiable. So a 4xx body is
handed upwards as `Ok`, exactly like a 200, and `TransportError` covers only the
cases with no envelope to read: no answer at all, or a 5xx gateway page.

**The error taxonomy and the response parser live in `mod.rs`.** The file list
above has no home for them, and `auth`, the service and the queue all share
them.

**The engine needed an injectable clock.** "The engine records `started_at` on
`start()`" is one line of the plan and two of code, but the engine had no
wall-clock time in it at all, and with a real clock the start of a track and its
halfway mark fall in the same second — so the test that the timestamp is the
former and not the latter could not be written. `Engine::with_clock` exists for
that test alone.

### 10b

**The poll cadence went to the frontend.** The plan put "the `auth.getSession`
poll" in `auth.rs`. Built there it would have meant a sleeping thread in Rust
and a timing behaviour with no cheap test; `auth.rs` answers one attempt and the
store loops, so the whole thing runs against a mocked `ipc` under fake timers.
The token crosses IPC as a consequence, which the plan did not anticipate and
which costs nothing: it is unauthorized, single-use and expires in an hour.

**Connecting is reached from Settings, not from the Account menu.** The plan
said "a settings pane with Connect/Disconnect and a status line" and separately
noted the Account menu was waiting. Both are true, but Connect cannot live in
the menu: it opens a browser, and the paragraph about what leaves the machine
has to be on screen first.

**No separate "scrobbling on/off" switch.** The plan's prose says "while
scrobbling is on", which reads as a second toggle beside the connection.
Connecting is the opt-in and Disconnect is the off switch; a second control that
can only differ from the first for users who want to stay connected and send
nothing was not worth the surface. Revisit if anyone asks for it.

### 10c

**Now playing needed an engine event.** The plan describes the five-second rule
but the engine had nothing between "loaded" and "played" - so `Event::NowPlaying`
was added beside `Event::Played`, carrying the same start timestamp so both
halves of the feature read the same clock.

**`Event::NowPlaying` and `Event::Played` are the whole interface.** The player
thread hands over a track id and a timestamp; the scrobbler thread resolves the
row, applies the rules and makes the call. The plan left open where the lookup
happened, and this is the only place it can: the player thread must not touch a
socket, and the rules need a `Track`.

**The scrobbler does not exist in a build with no key.** `Scrobbler::start`
returns `Option`, which makes the issue's "no request, no code-path change"
literal rather than merely true in effect.

### 10d

**A play made with no account is not queued.** The plan does not say either
way, and the queue makes the question real: keeping those rows would mean that
connecting an account later posted weeks of listening the user never offered.
Opt-in has to mean the plays as well as the connection.

**Only ignore code 5 is retried.** The plan says the queue must read each
scrobble's `ignoredMessage` rather than the top-level status, which is right,
but the reason turns out to be narrower than "so rejected scrobbles are not
marked sent": codes 1 to 4 are permanent, so those rows are dropped exactly like
accepted ones. The daily cap is the only reason worth waiting out, and telling
it apart from the others is what the per-scrobble read buys.

**`accepted()` became `outcomes()`**, returning the ignore codes rather than a
bool per scrobble, because the queue needs to tell 5 from 1.

**The service needed an injected clock too**, for the same reason the engine
did: backoff and the two-week age limit are entirely about *when*, and a test
that cannot move time can only assert that nothing has happened yet.
