# 82c — The review queue and the progress readout

The two things [82b](82b-the-unattended-lookup-pass.md) needs a user for: the
releases it would not write unattended, and some sign that four and a half hours
of work are happening. Both live in the sidebar.

## The queue

**A section under the playlist sections** — `Needs Review`, with the count
beside it the way a playlist carries its track count. Clicking it opens
[79b](../done/79b-online-release-lookup.md)'s dialog on the queue: a release at
a time, Skip moving to the next, which is the flow that dialog was already built
around.

**With the candidates already fetched.** The pass paid for that search a second
at a time; making the user pay it again is a rate-limited second per entry, and
412 entries is seven minutes of waiting to click. So `release_lookup` carries
the search results for a queued release and the dialog opens on the results
step rather than the searching one.

- They are a cache, not a record. Search again is still a button, and a stale
  candidate list is a worse answer than a slow one only if there is no way to
  refresh it.
- The tracklist is *not* cached with them. Picking a candidate is a deliberate
  act and one rate-limited second is the right cost for it; caching a detail the
  user may not pick is paying for the common case with the rare one.

An entry leaves the queue when the dialog applies it — `tagsource_apply` already
writes the release's identity to every file of it, so the row moves to resolved
on the same path a resolved release took.

*Open:* what Skip means here, which it did not have to mean in
[79b](../done/79b-online-release-lookup.md) because that queue died with the
dialog. Skipping in a persistent queue is either "not now" (the entry stays and
is offered again) or "leave this alone" (a fourth status, and the release is
never queued again). Both are wanted; the second needs a way back or it is a
trap. Recommendation: Skip means not-now, and a separate explicit action sets
the release aside — but this is a decision, not a detail.

## The progress readout

**Below the playlist sections, at the bottom of the sidebar**, where there is
space. Percentage to two decimals and an estimate from the last 100 releases.

- **Two decimals because a whole percent is eighty releases and forty minutes.**
  A figure that does not move for forty minutes reads as hung.
- **The last 100 rather than the whole pass**, because the rate is not steady: a
  release whose files already carry an MBID costs nothing and a searched one
  costs two seconds, so an average over the whole run describes a pass that is
  not the one running.

**One component fed by a task, not this task's own.**
[83](83-the-library-folder.md) has a second long task and reuses this. So it is
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

Testing: e2e screenshots — a new sidebar section and a standing readout are
worth capturing going forward. Specs written and pushed for CI to run.
