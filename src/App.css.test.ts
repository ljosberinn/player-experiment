import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The native-feel rules, asserted against the stylesheet itself.
 *
 * Phase 13 is mostly a set of things that must *not* be there, and absences
 * are exactly what nobody notices coming back. A component test cannot see
 * these - jsdom applies no stylesheet - so this reads the CSS as text.
 *
 * It is a blunt instrument on purpose: it parses top-level rules and looks at
 * declarations. Anything it cannot see through (a nested media query, a value
 * built from a variable) is out of its reach, and the checklist in PLAN.md
 * remains the real specification.
 */
const root = process.cwd().replaceAll("\\", "/");
const css = readFileSync(`${root}/src/App.css`, "utf8");

interface Rule {
  selector: string;
  body: string;
}

/** Top-level rules, with `@media` blocks flattened into the same list. */
function rules(source: string): Rule[] {
  const found: Rule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(source);
  while (match !== null) {
    found.push({ selector: (match[1] ?? "").trim(), body: match[2] ?? "" });
    match = pattern.exec(source);
  }
  return found;
}

const all = rules(css);

/** Selectors that may legitimately light up under the pointer. */
const HOVER_ALLOWED = [
  // Every Windows title bar highlights these; not doing so reads as broken
  // rather than as native. Called out in PLAN.md phase 13.
  ".window-buttons",
  // `.context-item` used to be here: a menu's active entry follows the
  // pointer by definition. Phase 24 removed the need for the exception rather
  // than the behaviour - Base UI sets `data-highlighted` for the pointer and
  // the keyboard alike, so the rule is a state selector, not a hover one.
];

/**
 * Selectors that may move.
 *
 * One entry, and it should stay that way. The playing indicator's motion *is*
 * the state rather than decoration on a state change, which is the line phase
 * 13 drew; see PLAN.md phase 16. The reduced-motion fallback below is not
 * optional for anything on this list.
 */
const ANIMATION_ALLOWED = [".row-status.playing .wave"];

describe("the stylesheet", () => {
  it("parses into rules", () => {
    // Guards the guard: a regex that matched nothing would pass everything.
    expect(all.length).toBeGreaterThan(50);
  });

  it("has no hover highlight on rows, cells or list items", () => {
    const offenders = all
      .filter((rule) => rule.selector.includes(":hover"))
      .filter((rule) => !HOVER_ALLOWED.some((allowed) => rule.selector.includes(allowed)))
      .filter((rule) => /background|color(?!-scheme)/.test(rule.body))
      .map((rule) => rule.selector);

    // Hover states say "this is a link". A desktop list communicates through
    // selection and focus instead.
    expect(offenders).toEqual([]);
  });

  it("uses the arrow cursor, not the hand", () => {
    const offenders = all
      .filter((rule) => /cursor:\s*pointer/.test(rule.body))
      .map((rule) => rule.selector);

    expect(offenders).toEqual([]);
  });

  it("declares no transition or animation on a component", () => {
    // The value is read rather than matched against with a lookahead: `\s*`
    // backtracks to nothing, so `:\s*(?!none)` succeeds on ": none" and the
    // check silently passes everything.
    const offenders = all
      .filter((rule) => !ANIMATION_ALLOWED.some((allowed) => rule.selector.includes(allowed)))
      .filter((rule) =>
        [...rule.body.matchAll(/(?:transition|animation)\s*:\s*([^;]+)/g)].some(
          (match) => (match[1] ?? "").trim() !== "none",
        ),
      )
      .map((rule) => rule.selector);

    // State changes are instant, the way a native list view repaints.
    expect(offenders).toEqual([]);
  });

  it("stops the one animation it allows under reduced motion", () => {
    // An exception that ignores the OS setting is not an exception, it is the
    // rule phase 13 removed coming back through a side door.
    const reduced = css.slice(css.indexOf("prefers-reduced-motion"));

    expect(reduced).toMatch(/\.row-status\.playing\s+\.wave\s*\{[^}]*animation:\s*none/);
  });

  it("keeps the row markers visible on the selected row", () => {
    // The playing speaker was `--accent` on a row whose background is
    // `--accent`: invisible until the selection moved off it. Any colour a
    // marker sets has to be taken back on the selected row, where the row's
    // own foreground is the only one guaranteed to contrast with its fill.
    const coloured = all
      .filter((rule) => /^\.row-status\.\w+$/.test(rule.selector.trim()))
      .filter((rule) => /(?:^|;|\s)color:/.test(rule.body))
      .map((rule) => rule.selector.trim().replace(".row-status", ""));

    const overridden = all
      .filter((rule) => rule.selector.includes(".song-row.selected"))
      .filter((rule) => /color:\s*inherit/.test(rule.body))
      .flatMap((rule) => rule.selector.split(","))
      .filter((selector) => selector.includes(".row-status"))
      .map((selector) => selector.trim().split(".row-status")[1] ?? "");

    expect(coloured.length).toBeGreaterThan(0);
    for (const state of coloured) {
      expect(overridden, `${state} needs a selected-row colour`).toContain(state);
    }
  });

  it("never says a state in colour alone", () => {
    // The missing marker is red, and red is exactly what a red-green colour
    // blindness does not deliver. The glyph has to carry it.
    const missing = all.find((rule) => rule.selector.includes(".row-status.missing"));

    expect(missing?.body).toMatch(/color:\s*var\(--danger\)/);
    expect(readFileSync(`${root}/src/features/library/RowStatusCell.tsx`, "utf8")).toMatch(
      /aria-hidden="true">!</,
    );
  });

  it("turns focus rings off only in favour of :focus-visible", () => {
    // `outline: none` on its own is an accessibility bug; paired with a
    // `:focus-visible` rule it is the correct way to drop the click ring.
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:/);
  });

  it("stops the window from bouncing as a document", () => {
    expect(css).toMatch(/overscroll-behavior:\s*none/);
  });

  it("keeps a caret and selectable text in fields", () => {
    const inputs = all.find((rule) => /^input,\s*textarea$/m.test(rule.selector));

    // `body` turns selection off wholesale; without this a text field would
    // inherit that and refuse to let its own contents be selected.
    expect(inputs?.body).toMatch(/user-select:\s*text/);
    expect(inputs?.body).toMatch(/cursor:\s*text/);
  });

  it("defines both themes for every colour variable", () => {
    // `rules()` flattens, so the dark `:root` is just the second one with that
    // selector - the media prelude is not part of any selector it returns.
    const roots = all.filter((rule) => rule.selector === ":root");
    const [light, dark] = roots;

    // Colours only, matched on the value rather than the name. Phase 21a added
    // density variables (`--row-height` and friends) which have no dark
    // variant and should not have one - requiring a duplicate would mean
    // stating the same measurement twice and letting the two drift.
    const colours = (body: string) =>
      [...body.matchAll(/(--[\w-]+):\s*([^;]+)/g)]
        .filter(([, , value]) => /^(#|rgb|hsl|color-mix)/.test((value ?? "").trim()))
        .map(([, name]) => name)
        .sort();

    expect(roots).toHaveLength(2);
    // Guards the guard: a value regex that matched nothing would compare two
    // empty lists and pass whatever the themes actually say.
    expect(colours(light?.body ?? "").length).toBeGreaterThan(5);

    // A colour defined only in light mode is a light-mode colour burned into
    // the dark theme, which is how dark modes end up with one unreadable panel.
    expect(colours(dark?.body ?? "")).toEqual(colours(light?.body ?? ""));
  });

  it("keeps every status bar child on one row", () => {
    // The bar is a three-column grid. Auto-placement only moves forward, so a
    // child assigned to an earlier column than the one before it in the DOM
    // starts a second row instead - which is exactly how the version and the
    // zoom stepper ended up below the summary. Stating the row on each makes
    // the layout independent of DOM order.
    const placed = all.filter((rule) => /\.statusbar-[\w-]+$/.test(rule.selector.trim()));
    const withColumn = placed.filter((rule) => /grid-column:/.test(rule.body));

    // Guards the guard: a selector regex that matched nothing would iterate an
    // empty list and pass however the bar is actually laid out.
    expect(withColumn.length).toBeGreaterThan(2);
    for (const rule of withColumn) {
      expect(rule.body, `${rule.selector} sets a column but no row`).toMatch(/grid-row:\s*1/);
    }
  });

  it("gives the status display a fixed height, not a growing one", () => {
    // `selector` carries any comment that preceded the rule, so this matches
    // the tail rather than the whole string.
    const rule = all.find((one) => /(^|\s)\.status-display$/.test(one.selector));

    // Idle shows one line; playing shows three plus a scrubber. A box that
    // sizes to its contents grows the moment a song starts and shoves the
    // toolbar down - the layout shift this pins shut.
    expect(rule).toBeDefined();
    expect(rule?.body).toMatch(/[^-]height:\s*\d/);
    expect(rule?.body).not.toMatch(/min-height/);
  });

  it("positions no menu by hand", () => {
    // Replaces the guard that required `.context-row { position: relative }`
    // against `.context-submenu { position: absolute }`. Both rules are gone:
    // a submenu is its own portalled popup that Floating UI anchors to the
    // item that opened it, so hand-written offsets would now fight it rather
    // than help. Their absence is the assertion.
    for (const selector of [".context-row", ".context-submenu"]) {
      const rule = all.find((one) => one.selector.trim().endsWith(selector));
      expect(rule, `${selector} should have gone with the hand-rolled menu`).toBeUndefined();
    }
  });

  it("highlights menu items from state rather than from :hover", () => {
    // Stricter than before, and able to be: the pointer and the keyboard both
    // set `data-highlighted`, so the menu no longer needs the hover exception
    // that `HOVER_ALLOWED` grants it - and a `:hover` rule would now fight the
    // keyboard, lighting up two rows at once.
    const hovered = all
      .filter((rule) => rule.selector.includes(".context-item"))
      .filter((rule) => rule.selector.includes(":hover"))
      .map((rule) => rule.selector);

    expect(hovered).toEqual([]);
    expect(css).toMatch(/\.context-item\[data-highlighted\]/);
  });
});
