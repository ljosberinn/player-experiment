# 98 — A write somewhere else locks the tag editor

Editing tags after a lookup's apply opened the dialog with Save already
disabled at "Saving…", `Writing 12 of 12…` under it, and Cancel, Escape and the
backdrop all refusing to close it — the state a write in flight puts the dialog
in, with no write running. Only a restart cleared it.

`tags://progress` is one channel for every tag write and `tagsource_apply`
sends on it too, but the editor store took every event unconditionally. Its
`save` is the only thing that clears `progress`, so an event from the lookup's
apply left `progress` set with nothing to unset it, and `saving` in `TagEditor`
is `progress != null`. Both stores now record only while their own write is in
flight: the lookup already guarded on `stage === "applying"`, and the editor
guards on `progress` being non-null, which `save` sets before it awaits.

The same guard drops an event that lands after the command's own reply. The
last `WriteProgress` of a batch and the reply are two messages over one bridge
and nothing orders them, so the editor's `finally` could be overtaken by its
own final event.

`tagsource`'s `close` left `stage` at `"applying"` for the same reason — the
apply that empties the queue is what closes the dialog. The review queue opens
without going through a release, so it came back on a table whose Cancel was
disabled. `close` resets `stage` and `progress` with the rest.
