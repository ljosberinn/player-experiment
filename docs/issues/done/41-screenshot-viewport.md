# 41 — Screenshots at a size somebody actually uses

Merged in #53, alongside phase 34 — numbered last, built fourth: 34 was the first
phase whose screenshots were the point of the review.

The PR-body screenshots were taken at whatever the harness window happened to be —
1416×864 at zoom 1.0, a laptop, not the case this app was built for. A reviewer
looking at a table designed for tens of thousands of rows saw about twenty.

Target: **1920×1080 with the interface at 90%**, roughly a third more rows in
frame.

- The window has to be able to *be* that size. GitHub's Windows runners boot at
  1024×768, so CI grows the virtual display first, via a P/Invoke to
  `ChangeDisplaySettings` from PowerShell — there is no cmdlet on the runner image.
  **It is allowed to fail**: a runner that refuses produces smaller screenshots.
- The viewport has to be sized in **physical** pixels, which is not what
  `window.innerWidth` reports once zoom is involved: 1920 wide at 0.9 zoom is a
  2133px CSS viewport. `e2e/viewport.ts` measures `innerWidth × devicePixelRatio`,
  adjusts by the difference, and repeats a bounded number of times.
- **Nothing asserts on any of it.** These are review aids; a smaller picture is not
  a failed test. The helper reports what it achieved — the same principle that made
  `capture()` return `false` rather than throw.
- Zoom is applied to the webview directly, not through the store: a screenshot has
  no business changing a preference that outlives it.
- The viewport is entered and left **around each capture**, not set for the run.
  The appearance and virtualization suites assert against the window they were
  written for, and a spec that resized permanently would make every later failure
  depend on run order.
