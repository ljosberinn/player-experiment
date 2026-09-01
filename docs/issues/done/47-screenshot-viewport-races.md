# 47 — The screenshot viewport photographed the wrong window

Phase 41 sized the window for each capture. Two defects in that sizing shipped
quietly, because nothing about a screenshot is asserted and a wrong-sized
picture looks like a picture.

Found by comparing `browse-albums-narrow` across two PRs: 3157×1218 in one and
686×942 in the next, against a `browse-albums-wide` of 2456×1218. The narrow
shot was the wider of the pair.

## `setWindowSize` resolves before the webview reports the new size

The correcting loop measured `innerWidth × devicePixelRatio` immediately after
each resize, and for some milliseconds that still describes the *previous*
window. So every iteration applied a shortfall it had already applied, and the
size the loop finally reported belonged to the window before last.

From the CI trace: window 1400 → measured 1384 → asked for 1936 → **measured
1384 again** → asked for 2472 → measured 1920, declared success, and photographed
a 2456-pixel viewport. Starting from 700 the same lag ran 1936 → 3172 → 4408 →
3173 and gave up.

`settledSize` waits for the reading to *change* before trusting it. Waiting for
it to reach the target instead would be circular — the target is what the loop
is still deciding — and a display that cannot grow that far still moves when it
is resized. It times out into the last reading rather than throwing, like
everything else here.

The arithmetic in `nextOuterSize` was never wrong, and its unit tests never
caught this: they test the correction, and the bug was in the measurement fed to
it.

## The log said it had arrived when it had not

`reached.width !== SHOT_WIDTH` where the loop stops within `TOLERANCE`, so a
converged 1921×1081 announced "the display is probably smaller" — while the run
that genuinely ended at 2456×1218 printed nothing at all, because the stale
reading it checked said 1920×1080. Both now read `arrived()`.

## A spec whose subject is the window size cannot use the review viewport

`capture()` grew to 1920×1080 before every shot, including the one taken
immediately after narrowing the window to 700 to prove the album grid reflows.
The grid reflowed back before the shutter fired. Even with the lag fixed, that
picture would be 1920 wide.

`capture(name, { ownWindow: true })` photographs the window the spec is holding.
The zoom is left alone too — 90% fits more columns across, and a narrow window is
the entire point.

`browse-layout` now asserts its narrow shot is narrower than its wide one. It is
the only assertion any of these pictures carries and it stays that way: a width
out of the PNG header is arithmetic, not a pixel comparison, and phase 27's
reasons for refusing pixel baselines all still hold.
