# 121 — Arrows move the selection

↑ and ↓ step the selection through the track list. With nothing selected they
do nothing. Volume loses the arrows.

**The keys.** Bare ↑/↓ replace the selection with the row one above or below
`selection.anchorIndex`, move the anchor there, scroll it into view and focus
it. Clamped at both ends. An empty selection, or a null anchor, returns without
touching the event. `isTypingTarget` stands the handler down in the search box
— and in the scrubber and the volume rail, which are `<input type="range">`, so
a focused rail keeps the arrows the range input gives it.

**Volume off the arrows.** `ArrowUp`/`ArrowDown` out of `shortcutFor`,
`volumeUp`/`volumeDown` out of `PlayerShortcut` and out of the switch in
`usePlayerShortcuts`. `VOLUME_STEP` stays: the wheel over the rail uses it. ←/→
still seek.

**Where it lives.** `SongTable`'s window keydown effect, beside the row-menu and
Alt+Arrow routes — it needs the virtualizer to scroll and the same `getState()`
discipline. Window-level rather than on the row, because a selection made with
Ctrl+A or left behind by a click in the sidebar has no row focused and still has
to move. The index arithmetic goes into `selection.ts` as a pure function.

**Rows that are not loaded.** `rowAt` returns null past the cached pages and the
selection is ids, so the move has to `ensureRange` the target row and select it
once it lands. A held key at a page boundary can outrun the fetch: a fetch that
resolves after the anchor moved again must not write a selection. Overscan 12
makes this rare, not impossible.

**Focus follows.** The target row may not be mounted until the scroll renders
it, so focus goes through the rAF-then-`tr[aria-rowindex]` route `openMenuAt`
already uses. Every row is `tabIndex={0}` today, which makes Tab walk all forty
in the window; only the anchor row keeps `0` and the rest take `-1`. That is a
new per-row `focused` prop, changing on two rows per move — priced like
`selected`.

No new CSS: `:focus-visible` in `primitives.css` is a 2px inset accent outline
and nothing on the row overrides it. Check it reads over `.selected`'s tint and
against [114](114-track-list.md)'s playing row, which takes `inset 3px 0 0` in
the same accent.

**What it breaks.**

- `shortcuts.test.ts` — the two arrow rows and the `targetOwns(range(),
  "volumeUp")` case. `usePlayerShortcuts.test.tsx` — the volume block.
- README's keyboard table: `↑ / ↓` is no longer volume.
- `frontend.md`'s shortcut bullets, including the Alt+Arrow one, whose "bare
  arrows are seek and volume" now reads "seek and the selection". The chord
  stands for the same reason it always did.
- `globalKeys.test.ts` forbids registering the arrows as global shortcuts.
  Unchanged, and still right.
- Alt+Arrow, the Menu key and Shift+F10 are untouched: this handler takes bare
  keys only.

**Not in scope.** Shift+Arrow, Home/End, PageUp/PageDown, Ctrl+Arrow. The anchor
doubles as the cursor here; a range extension wants a separate lead index, and
that is the decision to make when it is asked for.

Worth a screenshot in `library.test.ts` — a keyboard-moved selection with the
focus ring on it.

Independent of the component sweep. Its own worktree.
