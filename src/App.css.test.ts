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
const css = readFileSync(`${process.cwd().replaceAll("\\", "/")}/src/App.css`, "utf8");

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
  // A menu's active entry follows the pointer by definition - that is what
  // makes it a menu rather than a list of buttons.
  ".context-item",
];

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
      .filter((rule) =>
        [...rule.body.matchAll(/(?:transition|animation)\s*:\s*([^;]+)/g)].some(
          (match) => (match[1] ?? "").trim() !== "none",
        ),
      )
      .map((rule) => rule.selector);

    // State changes are instant, the way a native list view repaints.
    expect(offenders).toEqual([]);
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
    const names = (body: string) => [...body.matchAll(/(--[\w-]+):/g)].map((m) => m[1]).sort();

    expect(roots).toHaveLength(2);

    // A variable defined only in light mode is a light-mode colour burned into
    // the dark theme, which is how dark modes end up with one unreadable panel.
    expect(names(dark?.body ?? "")).toEqual(names(light?.body ?? ""));
  });
});
