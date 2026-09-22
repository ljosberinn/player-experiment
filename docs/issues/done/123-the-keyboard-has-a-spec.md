# 123 — The keyboard has a spec

`e2e/specs/shortcuts.test.ts` drives every key the app binds at the window.
Before it, F5 was the only key in the suite that was not Escape, Enter or
Backspace, and even that one is pressed on `body` alone.

**What is covered.** Space, ←/→ (seek), Escape, Delete, Ctrl+A, Ctrl+I,
Ctrl+plus/minus/0, Alt+←/→, and the mouse's side buttons. Two per binding: the
key does its thing, and the same key typed into the search box does not.

**Two bindings invert the second half**, and are asserted inverted. Zoom is not
suppressed while typing — `useZoomShortcuts` calls it chrome, not content — and
the side buttons work from inside the search box where Alt+← does not, because
a thumb on a mouse button is unambiguous where a hand on the keyboard is not. A
spec written to the bare rule fails against correct code.

**Pressed or dispatched.** Bare keys are pressed for real. Chords are
dispatched, for the reason `row-menu.test.ts` dispatches Shift+F10: Windows or
the webview claims Alt+Arrow and Ctrl+plus before the page sees a keydown. A
dispatched event with `bubbles` still has to reach a listener on `window`, and
still carries the `target` `isTypingTarget` reads, so both halves survive the
substitution. Whether the OS delivers the physical chord is now in *Uncovered
on purpose*, beside the media keys.

The side buttons are a `pointerdown`, not a `mouseup` — `useHistoryShortcuts`
binds it on purpose, because by the time the click arrives the browser has
decided nothing happened.

**Where it runs.** After `row-menu.test.ts`, which is what puts rows in front
of it, and before `row-drag.test.ts` because of Delete: inside a static
playlist Delete takes the membership row with no confirmation, and `row-drag`
makes the first playlist. Delete is driven as far as the question and no
further, for the reason `row-menu.test.ts` gives.

**Restore discipline.** Ctrl+plus persists through `zoomStore` to `settings`,
so a zoom left at 90% is not a red test — it is every screenshot after this one
taken at the wrong size. Reset after each zoom test and again in `after`,
alongside `player_stop`, an emptied search box and a return to Songs.

**The longest fixture, and the last row.** Glass, six seconds and the end of
the title-ascending order: a track that plays out mid-spec stops rather than
advancing and moving the assertions underneath it. The seek assertions run
paused, so the wall clock `SilentSink` advances on cannot make "it moved" true
by itself.

**One assertion that could not fail.** `smoke.test.ts` asserted `.content-error`
absent after a play command against an empty queue. That class renders only
inside `TagEditor`, `ReleaseLookup` and `CrashNotice`, none of them mounted
there. Now `.error-popup`, which is where a player error actually surfaces.

**Not in scope.** The media keys, and the physical chord. Everything else in
[123](../upcoming/123-e2e-coverage-gaps.md).
