# 27 — Appearance assertions in e2e

Merged in #44.

**The gap.** Three defects reached the user during phases 16–18: the playing icon
invisible on the selected row, the modal rendering below the footer, and form
fields with a border at 1.02:1 contrast. All three were layout or colour, and all
three passed 600+ green tests, because **jsdom applies no stylesheet**. The
`App.css.test.ts` guards catch only what they are told to, one regression at a
time, after the fact.

**Screenshots were the obvious answer and the wrong one.** Pixel baselines have to
be generated on the runner (font rendering differs from a developer machine), they
flake on antialiasing, they need storage for baselines and diffs, and a failure
reports "17,000 pixels differ" rather than what is wrong. And none of the three
defects was a pixel shift — each was a **computed value** that could simply have
been asked for.

So the suite asserts computed values in real WebView2 — `getComputedStyle`,
`getBoundingClientRect`, `elementFromPoint` — which is deterministic, needs no
baseline, costs no storage, and names the fault when it fails.

Asserted against the smart-playlist filter editor, the dialog an empty library can
reach and the densest row of controls in the app: every field's border clears 2:1
against its own fill; the dialog's rect is inside the viewport and
`elementFromPoint` at its centre lands inside it; three chrome pairs clear 4.5:1.

**Both themes in one run.** A runner boots light and two of the three defects were
dark-only. `App.css` gained a `[data-theme="dark"]` block holding the same values
as its `prefers-color-scheme` block — CSS cannot name a set of declarations and
apply it from two selectors — so `App.css.test.ts` asserts the two blocks are
identical, and the suite asserts the dark theme really is different, or a broken
`data-theme` would leave both passes silently running against light.

Left uncovered: anything needing a populated library. **Phase 30 closed that.**
