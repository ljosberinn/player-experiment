# Phase 10 — last.fm scrobbling

A plan, not a commitment. Written separately from `PLAN.md` because this is the
first feature that sends anything off the machine, and that deserves a decision
of its own rather than a bullet in a list.

Status: **draft, awaiting a go/no-go.** The authentication flow is decided
(username and password, in the app); how the resulting secret is stored is
the one question left, and it is question 1 at the end.

---

## Decided: username and password, entered in the app

The browser flow was recommended in the first draft and **rejected**. The
decision is `auth.getMobileSession`: a username and password field in the
settings pane, posted once over HTTPS, no browser trip and no OS keychain.

This section is what follows from that, because one part of the requirement
does not survive contact with the API and the rest of the plan depends on which
way it goes.

### The password does not need to be stored, and must not be

`auth.getMobileSession` is a **one-time exchange**. It takes the username and
password and returns a *session key* that does not expire. Every later call -
`track.updateNowPlaying`, `track.scrobble` - is signed with that key. last.fm
never asks for the password again.

So the requirement "we need to securely store the password" is not a
requirement of this flow. The password is needed for the length of one HTTPS
request, at the moment the user presses Connect, and after that it is
**garbage**. Storing it would create a liability with no purpose:

- users reuse passwords, so a stolen last.fm password is often a stolen
  something-else password. A stolen session key is only ever a last.fm session
  key.
- a session key can be revoked by the user from last.fm's own settings page,
  without changing anything. A password cannot be revoked, only changed.
- a session key grants scrobbling. A password grants the account, including
  changing the email on it.

**What gets stored is the session key.** The password is held in one `String`,
sent, and dropped - and the plan below is about protecting the key, because
that is the only secret that persists.

If there is a reason to keep the password itself - re-authenticating silently
after a revocation, say - that is worth stating explicitly, because it changes
this from "protect a revocable, single-purpose token" into "protect a
credential that probably unlocks the user's email too", and the bar moves
accordingly.

### "Securely, without OS integration" has a hard ceiling

This part deserves plain speech rather than a reassuring paragraph.

If the app can read the key at startup without the user typing anything, then
**anything running as that user can read it too** - by running the app's own
decryption, or by reading the app's memory. No amount of encryption inside the
process changes that, because the process must hold the means to decrypt. This
is not a limitation of any particular library; it is what "no user input, no OS
help" means.

So there are exactly three honest positions, and the middle one is the
recommendation:

| | What it is | Defeats | Does not defeat |
|---|---|---|---|
| **A. Plaintext in `settings`** | The key in the library database, excluded from exports | nothing | anything, including a `.sqlite3` file mailed to someone |
| **B. DPAPI** (recommended) | `CryptProtectData`, a Win32 call bound to the Windows user account | the database copied to another machine or another user; backups; casual inspection | code running as that user |
| **C. Passphrase at launch** | Key encrypted with something derived from a passphrase the user types every start | everything above, and local malware | nothing - it defeats the *user*, who now types a password every launch to avoid typing one once |

**B is the recommendation, and it is worth being precise about what it is not.**
DPAPI is not the Credential Manager, and not a keychain. There is no vault, no
prompt, no UI, no separate store to manage, and nothing appears in any OS
credential list. It is one function call that encrypts bytes such that only the
current Windows user account can decrypt them, and the ciphertext then lives in
the app's own settings table beside everything else. If "no OS integration"
means "no keychain UI and no credential vault", DPAPI satisfies it. If it means
"no Win32 calls at all", then the answer is A, and A should be shipped honestly
labelled rather than dressed up.

**What should not be built is the fourth option** - encrypting the key with a
constant compiled into the binary, or one derived from the machine's hardware
ids. It looks like B in a code review and is worth about as much as A: the key
to the ciphertext ships next to the ciphertext. Its only real effect is that
nobody, including us, can tell at a glance how exposed the secret is. If A is
what is chosen, it should look like A.

A note on scope either way: this is the same table the phase 9 export
deliberately filters. `settings::EXPORTABLE` is an *allowlist* precisely so a
credential added later cannot leak by being forgotten, and a test asserts the
session key is absent from an export.

## The network stack is already here

Worth keeping from the first draft, because it is still true and it removes the
main standing objection to this phase. Both phase 10 and phase 11 have been
held partly because they "add back the `reqwest`/TLS stack". They do not - it
already ships:

```
reqwest v0.13.4  (rustls-tls, no OpenSSL)
└── tauri-plugin-updater v2.10.1
    └── player
```

The updater has been pulling it in since phase 24, so the dependency cost of
this phase is roughly zero new crates. That does not retroactively make cutting
Sentry wrong - that was about what it would *send*, continuously, not about
what it linked - but it does mean this decision has to be made on the data
below rather than on the dependency graph.

---

## What actually leaves the machine

Everything below is the real cost of this phase, and it should be stated in the
UI in roughly these words rather than buried in a privacy policy nobody has
written.

Once, when the user connects an account:

- their last.fm username and password, over HTTPS, in a single request

Then per track played, for as long as scrobbling is on:

- artist, track title, album, track duration
- the timestamp the play started
- the session key identifying the account

That is it. Not the file path, not the folder name, not the library size, not
anything about the machine. And not the password again - see below, it is not
kept.

**It is opt-in and off by default.** A local-only music player that starts
talking to a server because it was installed would be a different product than
the one described at the top of `PLAN.md`. The user connects an account, or
nothing is ever sent.

---

## Shape

```
src-tauri/src/lastfm/
  mod.rs        the service: what to send and when
  auth.rs       username + password → session key, and where the key is kept
  secret.rs     sealing and unsealing the key at rest
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
| `auth.rs` | Same fake transport: the request carries the username and the password exactly once, a wrong-password response becomes the error the UI shows, and the session key that comes back is stored sealed. Plus the two that matter more than any of it: **the password is nowhere in the database afterwards**, and the key never appears in an export. | no |
| `secret.rs` | Round trip: seal, unseal, get the same bytes. Unseal of corrupt input returns `None` rather than panicking, which is the restored-from-another-machine case. | no |
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

Decided above: `secret.rs` seals it with DPAPI (`CryptProtectData` /
`CryptUnprotectData`, via the `windows` crate the project can already reach)
and the sealed bytes go in the `settings` table like everything else. One new
call, no vault, no prompt, nothing in any OS credential list.

`secret.rs` is a two-function module - `seal(&[u8]) -> Vec<u8>` and
`unseal(&[u8]) -> Option<Vec<u8>>` - which matters for two reasons. It keeps
the `unsafe` FFI in one readable place in a crate that otherwise sets
`unsafe_code = "forbid"`, so the exception is visible and bounded. And it means
choosing option A later is deleting a file rather than unpicking a decision.

`unseal` returning `None` is a normal state, not an error: a database restored
from another machine has a key that cannot be decrypted, and the right response
is to forget it and ask the user to connect again - not to fail the launch.

**The API secret** is a different problem with no clean answer: a desktop
application has to carry it, and anyone can extract it from the binary. This is
inherent to last.fm's model for desktop clients and is not solvable here. It
should be written down as accepted rather than pretended away - the mitigation
is that the secret alone is useless without a session key.

**The password**, for the seconds it exists: held in one `String`, sent, and
dropped. Never written to the database, never put in a log line, never included
in a panic message - the crash log from phase 29 writes the panic payload
verbatim, so a `.expect()` carrying credentials would land in a file on disk.
The test for this asserts the database contains no trace of the password after
a successful connect, which is cheap and catches the accidental
`settings::set` that a future refactor adds.

## Steps

Each is a branch and a PR, in this order, and each is useful on its own.

**10a — the seam and the signature.** `transport.rs`, `sign.rs`, the fake
transport, and the error taxonomy. No UI, no network, no credentials. Entirely
unit tested. This is the step that decides whether the rest is testable.

**10b — connect an account.** `auth.rs` and `secret.rs`: username and password
fields, one `auth.getMobileSession`, the sealed key, and a settings pane with
Connect/Disconnect and a status line. Ends with a session key on the machine,
no password anywhere, and nothing being scrobbled.

**10c — now playing and scrobbles.** `rules.rs` and the service, wired to the
player's existing `Event::Played` - which already exists and already fires at
the right moment, since it is what increments the play count. The rules module
decides; the service sends.

**10d — the offline queue.** `queue.rs`, backoff, batching, and a queue-depth
line in settings. Deliberately last: it is the part that only matters once the
happy path works, and the part most likely to need shaping by what the API
actually does.

## Open questions for the go/no-go

1. **Is DPAPI within "no OS integration"?** It is a Win32 call, not a keychain:
   no vault, no prompt, nothing in any credential list. If that counts as OS
   integration, the answer is plaintext in the settings table, shipped honestly
   labelled - and that is a legitimate choice for a local-only app, as long as
   it is a choice rather than an accident. What should not be built is
   encryption with a key that ships beside the ciphertext.
2. **Is there a reason to keep the password itself?** The plan says no, because
   the session key does not expire and can be revoked without it. If silent
   re-authentication matters, that changes the bar considerably and is worth
   deciding now rather than after 10b.
3. **Is a loopback `wiremock` test acceptable**, or should `transport.rs` stay
   uncovered on the principle that tests open no sockets at all?
4. **Does "local-only product" survive this?** It is worth asking plainly. The
   answer can reasonably be no, and the honest version of that answer is to
   close phase 10 rather than to leave it open indefinitely.
