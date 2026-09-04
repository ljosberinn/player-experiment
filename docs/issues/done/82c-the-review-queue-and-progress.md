# 82c — The review queue and the progress readout

The two things [82b](82b-the-unattended-lookup-pass.md) needs a user for: the
releases it would not write unattended, and some sign that four and a half hours
of work are happening. Both live in the sidebar.

## The queue

**A section under the playlist sections** — `Needs Review`, with the count
beside it the way a playlist carries its track count. Clicking it opens
[79b](79b-online-release-lookup.md)'s dialog on the queue: a release at
a time, Skip moving to the next, which is the flow that dialog was already built
around.

**With the candidates already fetched.** The pass paid for that search a second
at a time; making the user pay it again is a rate-limited second per entry, and
412 entries is seven minutes of waiting to click. So `release_lookup` carries
the search results for a queued release — 82b already writes them, as JSON, at
the moment it queues — and the dialog opens on the results step rather than the
searching one.

- They are a cache, not a record. Search again is still a button, and a stale
  candidate list is a worse answer than a slow one only if there is no way to
  refresh it.
- The tracklist is *not* cached with them. Picking a candidate is a deliberate
  act and one rate-limited second is the right cost for it; caching a detail the
  user may not pick is paying for the common case with the rare one.

An entry leaves the queue when the dialog applies it — `tagsource_apply` already
writes the release's identity to every file of it, so the row moves to resolved
on the same path a resolved release took.

*Settled:* **Skip means not-now, and Set Aside is the other decision.** Skipping
did not have to mean anything in [79b](79b-online-release-lookup.md), whose queue
died with the dialog. Here the entry stays and is offered again; `Set Aside` is a
second button, a fourth status, and the release leaves the queue and the count.
Offered on this queue alone — a selection's queue still dies with its dialog, so
there is nothing there to set aside.

The way back is the sidebar row, which is why it is a row and not a menu on one:
right-clicking a disabled button sends no events, and a row that hid itself once
the queue emptied would have taken the way back with it. So the row says what
there is to do — `Needs Review` with the queue's count while there is a queue,
`Set Aside` with the other count when putting them back is all that is left —
and while both exist the row's menu carries it. All of them come back at once: a
list of releases the user has said they do not want to look at is a second queue,
and the one thing it has to be is not a trap.

An orphan the issue did not account for: applying a lookup rewrites the album and
artist, so the row that queued the release is orphaned under its old key and the
count would never come down. `tagsource_apply` records the key it wrote as
resolved, which settles it and also keeps the pass off a release somebody has
just tagged by hand. Opening the queue prunes what a retag orphaned some other
way.

## The progress readout

**Below the playlist sections, at the bottom of the sidebar**, where there is
space. Percentage to two decimals and an estimate from the last 100 releases.

- **Two decimals because a whole percent is eighty releases and forty minutes.**
  A figure that does not move for forty minutes reads as hung. (Since
  [82e](82e-one-request-at-a-time.md) put the limiter at ten seconds a request
  it is nearer half an hour, and the pass nearer forty-five hours than four and
  a half — which is the argument, only more so.)
- **The last 100 rather than the whole pass**, because the rate is not steady: a
  release whose files already carry an MBID costs nothing and a searched one
  costs two seconds, so an average over the whole run describes a pass that is
  not the one running.

**One component fed by a task, not this task's own.**
[83c](../upcoming/83c-turning-the-library-folder-on.md) has a second long task and reuses this. So it is
a new channel — a label, done, total and an estimate — with 82b as its first
producer and 83 as its second.

`TaskProgress` in `features/shell` is not it and does not become it: that one
sits on the content header beside `ScanBar`, reads two existing per-write
channels, and reports on writes that finish in a minute. This is a different
place, a different lifetime and a different shape, and folding them would give
one component two homes.

Per `CLAUDE.md`, whatever `App` gains here subscribes inside its own component
the way `ScanBar` does, so a percentage ticking every two seconds re-renders a
line and not the sidebar.

Testing: the readout is photographed, fed a payload emitted from the webview —
its only producer needs the network and runs for two days. The sidebar row is
not: only the pass writes the rows it counts, which is the reason 79b's dialog
has no spec either, so it is covered by a component test instead.
