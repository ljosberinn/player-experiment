# 121 — Arrows move the selection

↑ and ↓ step the selection through the track list, and focus through the
sidebar. Volume loses the arrows.

**The keys.** Bare ↑/↓ replace the selection with the row one above or below
`selection.anchorIndex`, move the anchor there, scroll it into view and focus
it. Clamped at both ends, and the key is claimed there too: an unclaimed arrow
at the last row falls through to the scroll container, so a held key would walk
the selection down the list and then start sliding past it. An empty selection
or a null anchor returns without touching the event. `defaultPrevented` and
`isTypingTarget` stand the handler down — the latter covers the scrubber and
the volume rail, which are `<input type="range">` and keep the arrows they come
with.

**Where it lives.** `useSongTableWiring`, beside the row-menu route, not
`SongTable`. The wiring is what both views share: `ReleaseGroups` draws the
same rows against the same selection, and a keyboard that worked in the flat
table and not the drill-in is the difference nobody could explain. Window-level
rather than on the row, for the row menu's reason — Ctrl+A and a click in the
sidebar both leave focus off the table. The index arithmetic is `stepAnchor` in
`selection.ts`; the scroll-then-rAF-then-`tr[aria-rowindex]` route is `withRow`,
extracted from `openMenuAt`, which had it already.

**Rows that are not loaded.** The selection is ids, so a move onto an uncached
page has to wait for the row. `await ensureRange` is not that wait: it resolves
at once for a page already in flight, and after the move's own scroll that is
the usual case, because the visible-range effect has just asked for the same
page. So `moveAnchor(delta)` answers the target index synchronously — enough
for the scroll and the focus — and a store subscription writes the selection
when the page lands.

Nor is the uncached path rare. A selection outlives the pages behind it: select
row 0, scroll to row 10 000, and page 0 is long evicted (`CACHE_RADIUS_PAGES`
is 6, so 1200 rows).

A wait that is overtaken writes nothing and drops the step — a newer
`queryToken`, because the row indices mean nothing against another query, or an
anchor that moved on, which is a held key outrunning a fetch at a page
boundary. The next keypress starts from where the selection actually is.

**One tab stop per list.** Every row was `tabIndex={0}`, so Tab walked all forty
in the table's window — every row of every visible group, in the drill-in —
before reaching anything after them. Now `SongRow` takes a `focused` prop and
only the anchor row keeps `0`. It changes on two rows per move, priced like
`selected`.

The anchor scrolled out of the window falls back to the first rendered row: a
tab stop on a row nothing renders is a list the keyboard cannot enter at all.

**The sidebar follows.** Its tab stop is the `aria-current` row, and ↑/↓ walk
every `.sidebar-item` across all its sections. `LibraryNav` chose buttons over
a tablist for exactly this — "the arrows have to walk the whole sidebar" — and
a tablist would have owned them one section at a time. `Sidebar` writes the
`tabindex` onto the DOM over a `MutationObserver` rather than taking a roving
index as a prop: four components draw those rows and none can see the others,
and React sets no `tabIndex` on them, so nothing is fighting a render. The
arrows move focus only; Enter and Space open a view, and a sidebar that
navigated per keypress would re-query the library on each one. Claimed at the
ends too, so an arrow held past the last playlist cannot reach the track list.

**Volume off the arrows.** `ArrowUp`/`ArrowDown` out of `shortcutFor`,
`volumeUp`/`volumeDown` out of `PlayerShortcut` and out of the switch in
`usePlayerShortcuts`. `VOLUME_STEP` stays: the wheel over the rail uses it, and
the rail keeps its own arrows once focused. ←/→ still seek.

**No new CSS.** `:focus-visible` in `primitives.css` is a 2px inset accent
outline and nothing on the row overrides it. On a focused *playing* row it
merges with `.playing::before`'s 3px accent bar down the left edge; the ring
still reads on the other three sides, which is the verdict the e2e screenshot
holds.

**What it broke.** `shortcuts.test.ts` — the two arrow rows and the
`targetOwns(range(), "volumeUp")` case. `usePlayerShortcuts.test.tsx` — the
volume block. README's keyboard table. `frontend.md`'s shortcut bullets,
including the Alt+Arrow one, whose "bare arrows are seek and volume" now reads
"seek and the selection"; the chord stands for the same reason it always did.
`globalKeys.test.ts` forbids registering the arrows as global shortcuts —
unchanged, and still right. Alt+Arrow, the Menu key and Shift+F10 are
untouched: this handler takes bare keys only.

**Not in scope.** Shift+Arrow, Home/End, PageUp/PageDown, Ctrl+Arrow. The
anchor doubles as the cursor here; a range extension wants a separate lead
index, and that is the decision to make when it is asked for.

A dialog open over the table still lets a bare arrow reach the selection
behind it, unless the dialog claims the key. That hole is `useSelectionShortcuts`'s
too — Ctrl+A has it already — and belongs to whoever closes it there.
