# last.fm scrobbling — plan

**Draft, awaiting a go/no-go.** Written separately because this is the first
feature that sends anything off the machine, and that deserves a decision of its
own. The issue is [10](../issues/upcoming/10-lastfm-scrobbling.md).

## Authentication: username and password, in the app

The browser flow was recommended first and **rejected**. `auth.getMobileSession`
takes a username and password over HTTPS once and returns a **session key that
does not expire**; every later call is signed with that key. No browser trip, no
keychain.

**The password therefore must not be stored.** It is needed for the length of one
request. Storing it would be a liability with no purpose: users reuse passwords,
a session key can be revoked from last.fm's own settings page without changing
anything, and a session key only grants scrobbling where a password grants the
account. If silent re-authentication after a revocation matters, that changes the
bar considerably — question 2.

## "Securely, without OS integration" has a ceiling

If the app can read the key at startup without the user typing anything, then
anything running as that user can read it too — by running the app's own
decryption or by reading its memory. That is not a limitation of a library; it is
what "no user input, no OS help" means. Three honest positions:

| | What it is | Defeats | Does not defeat |
| --- | --- | --- | --- |
| **A. Plaintext in `settings`** | The key in the database, excluded from exports | nothing | anything, including a `.sqlite3` mailed to someone |
| **B. DPAPI** (recommended) | `CryptProtectData`, bound to the Windows user account | the database copied to another machine or user, backups, casual inspection | code running as that user |
| **C. Passphrase at launch** | Key encrypted from a passphrase typed every start | everything above, and local malware | the *user*, who now types a password every launch to avoid typing one once |

DPAPI is **not** the Credential Manager and not a keychain: no vault, no prompt,
nothing in any OS credential list — one call that encrypts bytes so only this
Windows account can decrypt them, with the ciphertext living in `settings` beside
everything else.

**What must not be built is the fourth option** — encrypting with a constant
compiled into the binary or derived from hardware ids. It looks like B in review
and is worth about as much as A, with the added cost that nobody can tell at a
glance how exposed the secret is. If A is chosen, it should look like A.

`secret.rs` stays two functions — `seal(&[u8]) -> Vec<u8>` and
`unseal(&[u8]) -> Option<Vec<u8>>` — which keeps the `unsafe` FFI visible and
bounded in a crate that otherwise forbids it, and makes choosing A later a file
deletion rather than an unpicking. **`unseal` returning `None` is normal**: a
database restored from another machine has a key that cannot be decrypted, and
the response is to forget it and ask the user to connect again, not to fail the
launch.

**The API secret** is a different problem with no clean answer: a desktop client
has to carry it and anyone can extract it. Inherent to last.fm's model, not
solvable here, and worth writing down as accepted. The mitigation is that the
secret alone is useless without a session key.

## The network stack already ships

`reqwest v0.13.4` (rustls, no OpenSSL) arrives via `tauri-plugin-updater`, so this
phase costs roughly zero new crates. That does not retroactively make cutting
Sentry wrong — that was about what it would *send*, continuously, not what it
linked — but this decision has to be made on the data below rather than on the
dependency graph.

## What actually leaves the machine

Say this in the UI in roughly these words.

Once, on connect: the username and password, over HTTPS, in one request.

Then per track played, while scrobbling is on: artist, title, album, duration, the
timestamp the play started, and the session key. **Not** the file path, the folder
name, the library size, or anything about the machine.

**Opt-in and off by default.** A local-only player that starts talking to a server
because it was installed is a different product.

## Shape

```
src-tauri/src/lastfm/
  mod.rs        the service: what to send and when
  auth.rs       username + password -> session key
  secret.rs     sealing and unsealing the key at rest
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

## Testing, given that nothing may reach last.fm

| Layer | How | Network |
| --- | --- | --- |
| `sign.rs` | known-vector tests: params sorted by name, concatenated, secret appended, MD5 | no |
| `rules.rs` | table-driven, incl. boundaries: longer than 30s, past half its length, has artist and title | no |
| `queue.rs` | real SQLite in a `tempfile`: enqueue, batch at 50, mark sent, retry order, permanent failure dropped rather than retried forever | no |
| `mod.rs` | fake transport recording every call, canned bodies for success, rate limit, invalid key, malformed XML, connection refused — this is where "queued offline, flushed on the next success" is asserted | no |
| `auth.rs` | fake transport: the password travels exactly once, a wrong password becomes the error the UI shows, the key is stored sealed — plus **the password is nowhere in the database afterwards** and the key never appears in an export | no |
| `secret.rs` | seal/unseal round trip; corrupt input returns `None` rather than panicking | no |
| `transport.rs` | one round trip against `wiremock` on `127.0.0.1`: request line, body encoding, non-200 → the right error | loopback |
| Frontend | the settings pane against a mocked `ipc`, like everything else | no |

The last row is the one worth arguing about — question 3. Without it, the only
code that opens a socket has no coverage at all: the fake transport proves the
logic while the real transport could be posting to the wrong URL with the wrong
content type. `wiremock` binds an ephemeral loopback port and the runner's egress
is never used.

**No credentials in CI.** A key is needed to *run* the feature, not to test it.

Two guards are about this feature not leaking rather than working: the session key
is absent from an export (`settings::EXPORTABLE` is an allowlist), and a crash
report containing it is never written — better, the key never becomes a `String`
that can reach a panic message, since `crash.rs` writes the payload verbatim.

## Steps

- **10a** — the seam and the signature. Decides whether the rest is testable.
- **10b** — connect an account. Ends with a sealed key on the machine, no password
  anywhere, and nothing scrobbling.
- **10c** — now playing and scrobbles, wired to the existing `Event::Played`,
  which already fires at the right moment because it is what increments the play
  count.
- **10d** — the offline queue. Last on purpose: it only matters once the happy path
  works, and it is the part most likely to be reshaped by what the API does.

Now-playing fires after 5 seconds of continuous playback and is fire-and-forget —
it describes a moment that has passed by the time a retry lands. A scrobble
submits once past 50% with the timestamp the track *started*; seeking backwards
past the threshold must not submit twice.

## Open questions for the go/no-go

1. **Is DPAPI within "no OS integration"?** If not, the answer is plaintext,
   honestly labelled — a legitimate choice for a local-only app as long as it is a
   choice.
2. **Is there a reason to keep the password itself?** The plan says no. Deciding
   after 10b is too late.
3. **Is a loopback `wiremock` test acceptable**, or does `transport.rs` stay
   uncovered on the principle that tests open no sockets?
4. **Does "local-only product" survive this?** The answer can reasonably be no,
   and the honest version of that answer is to close the phase rather than leave it
   open indefinitely.

Written before repeat existed: **each repeat loop is a play**, so each loop
scrobbles. Consistent with what phase 38 records locally, but worth re-reading
when this lands.
