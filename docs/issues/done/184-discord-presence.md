# 184 — Discord shows what is playing

Opt-in. With it on, Discord's status reads "Listening to <artist>", with the
title, the album, a cover and a progress bar — the Spotify card.

## Setup, outside the code

- Discord application "Apex", client ID `1554533728355754054` in
  `discord::CLIENT_ID`.
- The app logo uploaded under Rich Presence → Art Assets as `apex`.

## Shape

- `discord-rich-presence` 1.1 behind `discord::transport::Transport`. The real
  transport reads Discord's answer to every command; the crate does not, and a
  refusal would otherwise go unseen.
- A `presence` thread draining an `mpsc` of jobs, the scrobbler's shape.
- Fed from `Event::StateChanged` in `forward()`: track, status, and start/end as
  wall-clock ms computed on the player thread.
- Metadata read from SQLite on the presence thread.

## The activity

| Field | Value |
| --- | --- |
| `activity_type` | `Listening` |
| `status_display_type` | `State`; `Name` ("Listening to Apex") with no artist |
| `details` | title, else the file name |
| `state` | artist, omitted when blank |
| `assets.large_image` | `https://coverartarchive.org/release-group/{release_group_mbid}/front-500`, else `…/release/{release_mbid}/front-500`, else `apex` |
| `assets.large_text` | album, omitted when blank |
| `timestamps` | `start = now - position_ms`, `end = start + duration_ms` |

Text is trimmed and clamped to 2–128 UTF-16 units: truncated with `…`, padded
with U+200B.

Paused or stopped: the activity is cleared.

## Rules

- **Last write wins.** Sent 4s after the first unsent change. A report within
  1s of what is shown (a volume change) sends nothing.
- **Discord absent is not an error.** A failed connect or broken pipe drops the
  client; the next update retries, plus a 30s retry while something is wanted.
  Logged once per transition as `discord.link`. A refused activity is logged as
  `discord.refused` and not resent.
- **Setting off is no traffic.** `discord.presence`, default off, not
  exportable. `save_discord_presence` nudges the thread: off clears and closes
  the pipe at once, on sends the current state at once.
- Settings › Online, a Discord section below last.fm.

## Verification

- Discord running, setting on: play — "Listening to <artist>" in the member
  list; the card has title, artist, album, bar.
- Cover shows for a looked-up release, including a pressing with no art of its
  own (Nocte Obducta – Sequenzen einer Wanderung); `apex` logo otherwise.
- A track with no artist reads "Listening to Apex"; a one-letter title shows.
- Pause clears; resume and seek restore the bar at the right point.
- Skip through ten tracks fast: the card ends on the last one.
- Start Discord after Apex: presence appears within 30s. Quit Discord: nothing
  in the UI, playback unaffected.
- Setting off: card gone at once.
