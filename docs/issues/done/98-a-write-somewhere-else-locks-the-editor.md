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

`tagsource` had the same shape twice over: `stage` is what disables the
dialog's Cancel and stops Escape closing it, and an apply is what leaves it at
`"applying"`. Neither route back off a release reset it — `close`, which the
apply that empties the queue takes, nor `toTable`, which the apply that does
not takes. So an apply from the review queue returned to a table with no way
out, and the next `openReview` opened on one too, since it reaches the table
without going through a release. Both reset the stage and the readout with the
rest of what belongs to the release.
