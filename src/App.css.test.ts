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
 * built from a variable) is out of its reach, and the native-feel rules in
 * docs/knowledge/frontend.md remain the real specification.
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
  // rather than as native. Called out in phase 13.
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
 * 13 drew; see phase 16. The reduced-motion fallback below is not
 * optional for anything on this list.
 */
const ANIMATION_ALLOWED = [".row-status.playing .wave"];

/**
 * `oklch(L C H)` to linear sRGB, then to WCAG relative luminance.
 *
 * The palette is stated in `oklch`, and its lightness channel is *not* WCAG
 * luminance - `oklch(0.5 …)` is perceptually half-bright, which is nowhere near
 * half the light. Comparing the L values directly would be a plausible-looking
 * guard that passes unreadable pairs, so this does the real conversion: oklch →
 * oklab → LMS → linear sRGB, the transform from the CSS Color 4 specification.
 *
 * Out-of-gamut components are clamped, as a display would.
 */
function linearSrgb(colour: string): [number, number, number] {
  const [L = 0, C = 0, H = 0] = (colour.match(/[\d.]+/g) ?? []).map(Number);
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.min(1, Math.max(0, channel))) as [number, number, number];
}

function luminance(colour: string): number {
  const [r, g, b] = linearSrgb(colour);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** The `:root` block, which is the only place a colour may be written. */
const tokenBlock = css.slice(css.indexOf(":root {"), css.indexOf("\n}", css.indexOf(":root {")));

/** One token's value, by name. */
function token(name: string): string {
  return new RegExp(`--${name}:\\s*([^;]+)`).exec(tokenBlock)?.[1]?.trim() ?? "";
}

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

  it("writes every colour in one block and nowhere else", () => {
    // The reason a light theme stays cheap to restore. With the light and
    // `prefers-color-scheme` blocks gone (phase 33), nothing structural stops a
    // literal being written straight into a component rule - and every one that
    // is written there is a colour that would have to be found by hand later.
    //
    // The token block is exempt by definition; it is where they belong.
    const outside = css.slice(css.indexOf("\n}", css.indexOf(":root {")));
    const literals = [
      ...outside.matchAll(/(?:#[0-9a-f]{3,8}|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\()/gi),
    ].map((match) => {
      const line = outside.slice(0, match.index).split("\n").length;
      return `${match[0]} (roughly line ${line} after :root)`;
    });

    expect(literals).toEqual([]);
  });

  it("defines the tokens the rest of the sheet asks for", () => {
    // The other half of the rule above: a rule may only use `var()`, so a
    // `var(--typo)` would silently resolve to nothing rather than to a colour.
    const declared = new Set(
      [...tokenBlock.matchAll(/(--[\w-]+):/g)].map(([, name]) => name as string),
    );
    const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name as string));

    // Guards the guard: a regex that matched nothing would compare empty sets.
    expect(declared.size).toBeGreaterThan(15);
    expect([...used].filter((name) => !declared.has(name) && !name.startsWith("--a"))).toEqual([]);
  });

  it("keeps text readable on every surface it is drawn on", () => {
    // The palette is one hue at eight lightnesses, so a surface added a step
    // too close to the text above it is an easy and invisible mistake. WCAG AA
    // for body text is 4.5:1; these are the pairings the app actually makes.
    const failures = [
      ["text", "surface"],
      ["text", "chrome"],
      ["text", "field"],
      ["text", "row-odd"],
      ["muted", "surface"],
      ["muted", "chrome"],
      ["muted", "field"],
      ["muted", "sidebar"],
      ["danger", "surface"],
      ["on-accent", "accent"],
      ["on-danger", "destructive"],
    ]
      .map(([fore, back]) => ({
        pair: `${fore} on ${back}`,
        ratio: contrast(token(fore as string), token(back as string)),
      }))
      .filter((one) => one.ratio < 4.5)
      .map((one) => `${one.pair} = ${one.ratio.toFixed(2)}:1`);

    expect(failures).toEqual([]);
  });

  it("never fills with the accent under light text", () => {
    // This is the pairing the redesign had to correct: white on the amber is
    // 2.60:1, and it was the fill behind the *selected row* - the surface a
    // library is read on. Selection uses `--accent-tint` instead, and a solid
    // accent fill may only carry `--on-accent`.
    expect(contrast(token("text"), token("accent"))).toBeLessThan(4.5);

    const fills = all
      .filter((rule) => /background:\s*var\(--accent\)/.test(rule.body))
      // Anchored, or `border-color: var(--accent)` reads as a foreground and
      // every accent-bordered button is a false positive.
      .filter((rule) => /(?:^|[;{\s])color:\s*var\(--(?!on-accent)/.test(rule.body))
      .map((rule) => rule.selector);

    expect(fills).toEqual([]);
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

  it("gives the transport strip a fixed height, not a growing one", () => {
    // The layout shift this pins shut used to be inside the now-playing box:
    // idle showed one line, playing showed three plus a scrubber, and the box
    // grew the moment a song started. Phase 35 fixed that by construction -
    // the playhead is its own control on the strip and the box always shows
    // the same shape - so what has to hold now is the strip itself, which is
    // the row every one of those controls is measured against.
    //
    // `selector` carries any comment that preceded the rule, so these match
    // the tail rather than the whole string.
    const strip = all.find((one) => /(^|\s)\.transport-strip$/.test(one.selector));

    expect(strip).toBeDefined();
    expect(strip?.body).toMatch(/[^-]height:\s*\d/);
    expect(strip?.body).not.toMatch(/min-height/);

    // And the cover, which is the tallest thing on it: a thumbnail sized to
    // whatever image the file happened to carry would resize the strip.
    const cover = all.find((one) => /(^|\s)\.now-playing-cover$/.test(one.selector));

    expect(cover?.body).toMatch(/[^-]height:\s*\d/);
    expect(cover?.body).toMatch(/object-fit:\s*cover/);
  });

  it("keeps the title bar and the footer the heights the design draws", () => {
    // Both are stated rather than left to their contents, and both are what
    // the transport strip and the content pane are measured against. A bar
    // that sized itself would move every time a version string got a digit
    // longer or a menu label changed.
    for (const [selector, height] of [
      [".titlebar", 36],
      [".statusbar", 27],
    ] as const) {
      const rule = all.find((one) => one.selector.trim().endsWith(selector));
      expect(rule?.body, `${selector} should state its height`).toMatch(
        new RegExp(`[^-]height:\\s*${height}px`),
      );
    }
  });

  it("blurs behind every translucent panel of chrome", () => {
    // The panels are veils rather than fills so that phase 39's cover colours
    // can drift behind them. A veil with no blur under it is just a slightly
    // wrong colour - and worse, it lets whatever is behind it show through
    // sharply, which is how translucent chrome turns text unreadable.
    // The three blurred panels by name. `--hover-veil` is not one of them: it
    // is the lift a title-bar button gives under the pointer, painted on top
    // of chrome rather than being chrome. Nor is `--content-wash`, which is a
    // tint over the window rather than a sheet of frosted glass.
    const veiled = all.filter((rule) =>
      /background:\s*var\(--(?:chrome|strip|sidebar)-veil\)/.test(rule.body),
    );

    // Guards the guard: a regex matching nothing would iterate an empty list.
    expect(veiled.length).toBeGreaterThan(2);
    for (const rule of veiled) {
      expect(rule.body, `${rule.selector} is translucent but does not blur`).toMatch(
        /backdrop-filter:\s*blur/,
      );
    }
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

  it("positions every portalled overlay itself", () => {
    // The bug this exists for: `.modal` was centred by being a flex child of
    // `.modal-backdrop`. Base UI renders the two as siblings in a portal, so
    // the dialog fell into normal flow at the end of the body and drew below
    // the footer. Nothing could have caught it in a component test - jsdom
    // applies no stylesheet - and the app still passed 630 of them.
    //
    // Anything the app portals to the body has to carry its own position.
    for (const selector of [".modal", ".modal-backdrop", ".context-positioner"]) {
      const rule = all.find((one) => one.selector.trim().endsWith(selector));

      expect(rule, `${selector} should exist`).toBeDefined();
      expect(rule?.body, `${selector} must position itself`).toMatch(/position:\s*fixed|z-index:/);
    }

    // And the dialog has to sit above its own backdrop, not merely somewhere.
    const modal = all.find((one) => one.selector.trim().endsWith(".modal"));
    const backdrop = all.find((one) => one.selector.trim().endsWith(".modal-backdrop"));
    const layer = (body: string | undefined) => Number(/z-index:\s*(\d+)/.exec(body ?? "")?.[1]);

    expect(layer(modal?.body)).toBeGreaterThan(layer(backdrop?.body));
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

  it("gives form fields a border you can actually see", () => {
    // This is the bug that shipped: `--chrome-border` is tuned to separate two
    // panels of chrome, and in dark mode it was #1a1a1c against a #191a1c field
    // - a contrast ratio of about 1.02:1. The input was invisible and a select
    // was recognisable only by its arrow. jsdom applies no stylesheet, so no
    // component test could have caught it; this reads the colours and does the
    // arithmetic.
    //
    // Against the field's own fill, and against the panel behind it: a border
    // that only clears one of the two still leaves an edge missing.
    expect(contrast(token("field-border"), token("field")), "border vs field").toBeGreaterThan(2);
    expect(contrast(token("field-border"), token("chrome")), "border vs dialog").toBeGreaterThan(2);

    // And the fields must actually use it rather than the chrome divider.
    const fields = all.find((rule) => /\.modal input,\s*\.modal select/.test(rule.selector));
    expect(fields?.body).toMatch(/border:[^;]*var\(--field-border\)/);
  });

  it("uses the numeral face for numbers and not for prose", () => {
    // Space Grotesk is the design's one typographic signature and its whole job
    // is figures. Set on `body` it would turn the entire app into a poster, so
    // the guard is that the token exists, that the places numbers are read use
    // it, and that the UI font is still what everything else inherits.
    expect(token("font-numeric")).toMatch(/Space Grotesk/);

    const root = all.find((rule) => rule.selector.trim().endsWith(":root"));
    expect(root?.body).toMatch(/font-family:\s*"Segoe UI"/);

    for (const selector of [".scrubber-time", ".song-cell.right", ".statusbar-zoom-value"]) {
      const rule = all.find((one) => one.selector.trim().endsWith(selector));
      expect(rule?.body, `${selector} should set the numeral face`).toMatch(
        /font-family:\s*var\(--font-numeric\)/,
      );
    }
  });
});
