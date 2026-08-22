# 13 — Native feel pass

Merged in `daae2cf`. Deliberately after the features, not before: every phase
adds chrome, and doing this once is cheaper than policing it per PR.

What shipped is mostly removals — the webview context menu outside text fields,
all ten `cursor: pointer` declarations, every transition and animation, the
overscroll bounce, the focus ring on click, the browser drag image. Selection
survives losing focus, dimmed via `color-mix`, as Explorer does. A drag badge
("7 songs") replaces the translucent row screenshot; it is built off-screen
rather than hidden, because `display: none` and `visibility: hidden` both make an
element unrasterizable.

The lasting part is the guard: **`App.css.test.ts` reads the stylesheet as text
and asserts the absences**, because absences are what nobody notices coming back
and jsdom applies no stylesheet at all.

Two things it cannot reach, left manual: density against Explorer/iTunes, and
font smoothing on Windows.

Also fixed here, both from the same "reachable in theory" family: Ctrl+A got a
binding (`useSelectionShortcuts`, with Escape to clear), and both dialogs learned
to answer Enter and Escape — deferring that to a polish phase had been the wrong
call, since a form you cannot submit with Enter is broken, not unpolished.
