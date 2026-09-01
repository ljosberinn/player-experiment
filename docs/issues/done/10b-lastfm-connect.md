# 10b — connecting a last.fm account

Second of four. Ends with a session key on the machine and nothing scrobbling.

- `lastfm/auth.rs` — `auth.getToken`, the authorize URL, one attempt at
  `auth.getSession`, and the three functions that store, read and forget the
  session.
- `lastfm/mod.rs` — `credentials()` and `signed()`, the parameter list every
  authenticated call shares.
- Four commands, a store, a Settings section, and the Account menu, which has
  been shipped empty and disabled since phase 34 waiting for this.

## Decisions

**The poll cadence is in the frontend.** `auth.rs` answers one attempt at a
time — `Poll::NotYet` for error 14, which is the only failure that is not one —
and the store decides how often to ask. Nothing in Rust sleeps, and the timing
is testable against a mocked `ipc` like everything else. The token crosses IPC
because of it, which is fine: it is unauthorized, single-use and valid for an
hour, so it is not a credential.

**A second Connect retires the first.** The store keeps a generation counter
and the loop rechecks it after every await. Without one, pressing Connect
twice leaves two loops running against two tokens and whichever lands first
wins.

**It gives up after three minutes**, well inside the token's hour. What runs
out is the user's patience, not the token — someone who closed the tab should
not leave a poll running for an hour, and the cost of giving up early is one
click.

**A build with no API key is a first-class state, not an error.** It is what
every local build and every CI run is. The Account menu stays disabled, the
Connect button is disabled, and the status line says the build carries no key —
rather than offering a button that can only fail.

**Connecting is not in the Account menu.** It opens a browser, and the sentence
saying what leaves the machine has to be in front of the user before that
happens; a menu item has nowhere to put it. So the menu names the account and
offers Disconnect, and Connect… opens Settings.

**Disconnect is local only.** last.fm has no method to revoke a session key.
The honest thing is to forget it and say where the user can revoke it properly,
which the pane does.

**The pane says what leaves the machine, in the UI and not only in a doc.** An
API key on connect; artist, title, album, length and the start time per play;
never the path, the folder, the library size or anything about the machine. And
that the key is stored unencrypted — if it is, it must look it.

## Rerenders

`App` gains two scalar subscriptions so the Account menu can name the account.
In a build with no key the startup read returns what the store already held, and
zustand compares selector output by `Object.is`, so nothing wakes at all.
Connecting re-renders the tree once, which is the floor while the menu bar names
the account. `App.renders.test.tsx` asserts both, including that a second write
of the same status wakes nothing.

## Tests

- `auth.rs` — the signature covers neither itself nor `format`; error 14 polls
  again; 15 surfaces and is not transient; half a session is malformed rather
  than stored; a session round-trips; **and the stored key never reaches an
  export**, asserted against the real writer rather than against the allowlist.
- `store.test.ts` — the poll under fake timers: keeps asking, stops on an
  answer, gives up at the deadline and stays stopped, Cancel is final, a second
  Connect retires the first, a failed disconnect keeps the account.
- `LastfmSettings.test.tsx` — the four status lines, the button each implies,
  and that the paragraph about what leaves the machine is on screen.
- `menus.test.ts` — Account stays empty without a key, offers the way in with
  one, and names the account with a connection.

## Not here

Nothing scrobbles yet. `Event::Played` still only increments a play count.
