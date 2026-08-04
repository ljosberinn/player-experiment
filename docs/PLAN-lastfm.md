# Phase 10 — last.fm scrobbling

A plan, not a commitment. Written separately from `PLAN.md` because this is the
first feature that sends anything off the machine, and that deserves a decision
of its own rather than a bullet in a list.

Status: **draft, awaiting a go/no-go.**

---

## Two premises worth correcting before anything is built

**1. It does not need a password.** The brief for this said "be mindful of the
authentication step (this needs user/password)". It does not, and should not.
last.fm has two authentication flows:

| Flow | How | What the app handles |
|---|---|---|
| **Desktop / web auth** | `auth.getToken` → open `last.fm/api/auth?api_key=…&token=…` in the user's **browser** → they approve there → `auth.getSession(token)` | A token and a session key. **Never a password.** |
| `auth.getMobileSession` | The app collects username + password and posts them | The user's actual last.fm password, in our process, in our memory |

The first is what last.fm documents for desktop applications, and it means this
project never has a text field that a last.fm password is typed into — nothing
to leak, nothing to shred from memory, nothing to accidentally log in a crash
report. The second exists mainly for mobile apps that cannot open a browser,
which is not us.

**Recommendation: the browser flow, and no in-app password field at all.** If
"leaving the app to approve" is judged unacceptable UX, `getMobileSession` is
the fallback, but it should be a deliberate decision and not a default.

**2. The network stack is already here.** The stated reason phase 11 was cut,
and the stated reason this phase has been held, is that it "adds back the
`reqwest`/TLS stack". It does not — that stack already ships:

```
reqwest v0.13.4
└── tauri-plugin-updater v2.10.1
    └── player
```

with `rustls-tls`, no OpenSSL. The updater has been pulling it in since phase
24. So the dependency cost of this phase is roughly **zero new crates**; what
remains is the part that always mattered more, which is the next section.

This does not retroactively make phase 11 the wrong call. Sentry was cut
because of *what it would send* — paths, folder names, track titles, off the
machine, continuously — not because of what it linked.

---

## What actually leaves the machine

Everything below is the real cost of this phase, and it should be stated in the
UI in roughly these words rather than buried in a privacy policy nobody has
written.

Per track played, when scrobbling is on:

- artist, track title, album, track duration
- the timestamp the play started
- the session key identifying the account

That is it. Not the file path, not the folder name, not the library size, not
anything about the machine.

**It is opt-in and off by default.** A local-only music player that starts
talking to a server because it was installed would be a different product than
the one described at the top of `PLAN.md`. The user connects an account, or
nothing is ever sent.

---

## Shape

```
src-tauri/src/lastfm/
  mod.rs        the service: what to send and when
  auth.rs       token → session key, and where the key is kept
  sign.rs       the api_sig construction (pure)
  rules.rs      whether a play is scrobbleable (pure)
  queue.rs      the offline queue, over SQLite
  transport.rs  the trait, and the one implementation that uses the network
```

**`transport.rs` is the seam, and it is the whole testing strategy.** It is the
same shape as `audio::sink::AudioSink`: a trait with one real implementation
that talks to the outside world, and a fake one that tests drive instead. That
pattern is already load-bearing in this codebase — the entire playback state
machine is tested against `FakeSink` on a CI runner with no sound card — and it
is what makes the constraint below satisfiable rather than aspirational.

```rust
pub trait Transport: Send {
    /// One signed POST to the last.fm API root.
    fn post(&self, params: &[(&str, String)]) -> Result<String, TransportError>;
}
```

Nothing above `transport.rs` knows HTTP exists.

---

## Testing, given "nothing may reach last.fm"

The constraint is: tests must not authenticate against last.fm and must not
scrobble to it, unless the network is fully mocked. Here is how each layer is
covered without a packet leaving the process.

| Layer | How | Touches the network |
|---|---|---|
| `sign.rs` | Known-vector unit tests: parameters sorted by name, concatenated, secret appended, MD5. last.fm publishes the algorithm and a worked example. | no |
| `rules.rs` | Unit tests for last.fm's own rules — longer than 30s, played past half its length **or** past four minutes, has artist and title. Table-driven, including the boundaries. | no |
| `queue.rs` | Real SQLite in a `tempfile`, like every other db module: enqueue, batch at the 50-per-call limit, mark sent, retry ordering, and that a permanent failure is dropped rather than retried forever. | no |
| `mod.rs` (the service) | Driven against a **fake transport** that records every call and returns canned bodies — success, rate limit, invalid session key, malformed XML, connection refused. This is where "a scrobble is queued when offline and flushed when the next one succeeds" is asserted. | no |
| `auth.rs` | Same fake transport: token requested, browser URL built correctly, session key stored, and — the one that matters — **the key never appears in an export or a crash report**. | no |
| `transport.rs` | One round trip against a `wiremock` server bound to `127.0.0.1`, asserting the request line, the body encoding and that a non-200 becomes the right error. | loopback only |
| Frontend | The settings pane against a mocked `ipc` module, as every other component is. | no |

**The one entry worth arguing about is the last.** Without it, the only code in
this feature that opens a socket has no coverage at all — the fake transport
proves the *logic* correct while the real transport could be posting to the
wrong URL with the wrong content type and no test would notice. A loopback
server closes that hole and still sends nothing anywhere: `wiremock` binds an
ephemeral port on 127.0.0.1, the client is pointed at it by injecting the API
root, and the runner's egress is never used. If even that is unwanted, the
alternative is to accept `transport.rs` as untested and keep it small enough to
read in one screen.

**No credentials in CI.** There is no last.fm API key in the repository, no
secret in Actions, and no test that would use one. A key is needed to *run* the
feature, not to test it.

Two guard tests worth calling out because they are about this feature not
leaking rather than about it working:

- the settings export allowlist (`settings::EXPORTABLE`) already excludes
  anything not named in it, which is why it was written as an allowlist — a
  test asserts the session key is absent from an export;
- a test asserts a crash report (phase 29) containing a session key in a panic
  message is still not written. Better: the key never becomes a `String` that
  can reach a panic message in the first place.

---

## Where the session key lives

Not in the `settings` table. It is a bearer credential — anyone holding it can
scrobble as the user and read their listening history — and the library
database is a file the user may well copy around or back up.

**Windows Credential Manager**, via the `keyring` crate (which uses DPAPI under
the hood), keeps it encrypted to the Windows user account. One new dependency,
and it is the platform's answer to exactly this question.

The **API secret** is a different problem with no clean answer: a desktop
application has to carry it, and anyone can extract it from the binary. This is
inherent to last.fm's model for desktop clients and is not solvable here. It
should be written down as accepted rather than pretended away — the mitigation
is that the secret alone is useless without a session key.

---

## Steps

Each is a branch and a PR, in this order, and each is useful on its own.

**10a — the seam and the signature.** `transport.rs`, `sign.rs`, the fake
transport, and the error taxonomy. No UI, no network, no key. Entirely unit
tested. This is the step that decides whether the rest is testable.

**10b — connect an account.** `auth.rs`, the browser flow, the keyring, the
settings pane with Connect/Disconnect and a status line. Ends with a session
key on the machine and nothing being sent.

**10c — now playing and scrobbles.** `rules.rs` and the service, wired to the
player's existing `Event::Played` — which already exists and already fires at
the right moment, since it is what increments the play count. The rules module
decides; the service sends.

**10d — the offline queue.** `queue.rs`, backoff, batching, and a queue-depth
line in settings. Deliberately last: it is the part that only matters once the
happy path works, and it is the part most likely to need shaping by what the
API actually does.

## Open questions for the go/no-go

1. **Browser flow or in-app password?** The recommendation is the browser flow
   and no password field. This is the only question that changes the shape of
   10b.
2. **Is a loopback `wiremock` test acceptable**, or should `transport.rs` stay
   uncovered on the principle that tests open no sockets at all?
3. **`keyring` as a dependency**, or the session key in the settings table with
   the export allowlist as the only protection? The second is materially worse
   and cheaper by one crate.
4. **Does "local-only product" survive this at all?** It is worth asking
   plainly. The answer can reasonably be no, and the honest version of that
   answer is to close phase 10 rather than to leave it open indefinitely.
