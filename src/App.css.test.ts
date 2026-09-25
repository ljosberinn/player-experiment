import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { RAMP_STEPS } from "./components/charts/scales";

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

/**
 * The sheet, in cascade order.
 *
 * Four files since phase 110, and read as a set rather than through
 * `App.css`: every guard below that asserts an *absence* - no literal colour,
 * no hover highlight, no transition - is worth exactly as much as the fraction
 * of the sheet it can see. Reading the entry point alone would have seen four
 * `@import` lines and passed everything.
 *
 * A sheet added here and forgotten in this list is the one way a primitive
 * leaves every absence guard at once, which is why the component library is
 * one file rather than one per component.
 */
const SHEETS = ["tokens", "primitives", "library", "app"] as const;
const sources = SHEETS.map((name) => readFileSync(`${root}/src/styles/${name}.css`, "utf8"));
const css = sources.join("\n");
const entry = readFileSync(`${root}/src/App.css`, "utf8");

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
  // `.window-buttons` used to be here, for the reason every Windows title bar
  // highlights its caption buttons. Phase 119 gave the frame back to the OS,
  // so there are no caption buttons left to except.
  // The two button primitives, phase 110. The rule this list guards is about
  // rows, cells and list items - a surface you are reading, lighting up under
  // a pointer that is only passing over it. A button is the opposite: it is a
  // target, and every native one on this platform reports that it can be
  // pressed. The specimen sheet draws a hover and a press for all four kinds.
  //
  // Both spellings, because `.icon-button` does not contain `.button`.
  ".button",
  ".icon-button",
  // `.menu-item` used to be here: a menu's active entry follows the
  // pointer by definition. Phase 24 removed the need for the exception rather
  // than the behaviour - Base UI sets `data-highlighted` for the pointer and
  // the keyboard alike, so the rule is a state selector, not a hover one.
];

/**
 * Selectors that may move.
 *
 * Two entries, and it should stay that way. The playing indicator's motion *is*
 * the state rather than decoration on a state change, which is the line phase
 * 13 drew; see phase 16. The background that follows the music (phase
 * 39) is the second: its turn is the feature, not a flourish on a state change,
 * and it carries no information a static version would lose. The reduced-motion
 * fallback below is not optional for anything on this list.
 */
const ANIMATION_ALLOWED = [".row-status.playing .wave", ".dynamic-bg"];

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

/** The alpha an `oklch(L C H / A)` carries, or 1 for an opaque one. */
function alphaOf(colour: string): number {
  return colour.includes("/") ? Number((colour.match(/[\d.]+/g) ?? []).at(-1)) : 1;
}

const toGamma = (channel: number) =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
const toLinear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/**
 * The luminance of a stack of token values, flattened as a browser would.
 *
 * Phase 108 shipped three defects past this file because it only ever compared
 * one token to another, and half this app's surfaces are not tokens: the
 * chrome is a veil, so the colour behind the transport's rails is
 * `--strip-veil` composited onto `--surface` and is written down nowhere. All
 * three looked fine here and failed in the engine nine minutes later.
 *
 * `layers` runs front to back, as painting order sees it. Compositing happens
 * in *gamma-encoded* sRGB rather than in linear light, because that is where a
 * browser does it - the same arithmetic as `e2e/contrast.ts`, deliberately, so
 * that the two cannot disagree about what 4.5:1 means.
 */
function stackLuminance(layers: string[]): number {
  let [r, g, b] = [0, 0, 0];
  for (const layer of [...layers].reverse()) {
    const alpha = alphaOf(layer);
    const [lr, lg, lb] = linearSrgb(layer).map(toGamma) as [number, number, number];
    r = lr * alpha + r * (1 - alpha);
    g = lg * alpha + g * (1 - alpha);
    b = lb * alpha + b * (1 - alpha);
  }
  const [lr, lg, lb] = [r, g, b].map(toLinear) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** The ratio between one token and whatever stack is painted behind it. */
function contrastOver(fore: string, layers: string[]): number {
  const [high, low] = [luminance(fore), stackLuminance(layers)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
}

/** The two grounds `tokens.css` defines, and which every pair is asserted on. */
const GROUNDS = ["light", "dark"] as const;
type Ground = (typeof GROUNDS)[number];

/** `tokens.css`, which is the only file a colour may be written in. */
const tokensSheet = sources[0] ?? "";

/**
 * Comments out.
 *
 * Not cosmetic: `rules()` sweeps everything since the previous brace into the
 * selector, and the comment at the top of `tokens.css` explains the cascade by
 * naming both `[data-theme="light"]` and `[data-theme="dark"]`. Matching a
 * block by its raw selector would therefore find the *shared* `:root` block
 * for either ground, and every pair below would be asserted twice against the
 * same empty set of tokens - a guard that passes whatever it is given.
 */
function uncommented(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, "");
}

const tokenRules = rules(tokensSheet);

/**
 * One ground's block of definitions.
 *
 * Found by the `[data-theme="…"]` in its selector rather than by position, so
 * that reordering the two, or adding a third, cannot silently point this at
 * the wrong one.
 */
function groundBlock(ground: Ground): string {
  return (
    tokenRules.find((one) => uncommented(one.selector).includes(`[data-theme="${ground}"]`))
      ?.body ?? ""
  );
}

const blocks = Object.fromEntries(GROUNDS.map((g) => [g, groundBlock(g)])) as Record<
  Ground,
  string
>;

/** One token's value on one ground, by name. */
function token(name: string, ground: Ground): string {
  return new RegExp(`--${name}:\\s*([^;]+)`).exec(blocks[ground])?.[1]?.trim() ?? "";
}

/** The names one block declares. */
function names(block: string): string[] {
  return [...uncommented(block).matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name as string);
}

/** Every custom property `tokens.css` declares, shared or per ground. */
const declaredTokens = new Set(names(tokensSheet));

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

  it("stops every animation it allows under reduced motion", () => {
    // An exception that ignores the OS setting is not an exception, it is the
    // rule phase 13 removed coming back through a side door.
    const reduced = css.slice(css.indexOf("prefers-reduced-motion"));

    expect(reduced).toMatch(/\.row-status\.playing\s+\.wave\s*\{[^}]*animation:\s*none/);
    // The background stops turning *and* stops washing between albums: a
    // 1.6s crossfade is motion too.
    expect(reduced).toMatch(/\.dynamic-bg\s*\{[^}]*animation:\s*none/);
    expect(reduced).toMatch(/\.dynamic-bg\s*\{[^}]*transition:\s*none/);
  });

  it("registers the blob colours so they can be transitioned", () => {
    // A custom property is an uninterpolatable token string unless it is
    // registered with a syntax. Without these three `@property` blocks the
    // transition above parses, applies and does nothing, and the wash between
    // albums silently becomes a cut - which is the kind of failure nobody
    // notices for a year.
    for (const name of ["--blob-1", "--blob-2", "--blob-3"]) {
      // `endsWith` rather than equality: `rules()` sweeps up whatever
      // precedes the brace, comments included, into the selector.
      const declared = all.find((rule) => rule.selector.endsWith(`@property ${name}`));
      const block = declared?.body ?? "";

      expect(block, `${name} is not registered`).toMatch(/syntax:\s*"<color>"/);
      // Inherited, because the gradients that read them are on a pseudo-element
      // of the div React writes them to.
      expect(block).toMatch(/inherits:\s*true/);
    }
  });

  it("gives every pane that tiles the window a veil rather than a fill", () => {
    // The bug this exists for, and it cost three attempts to find. `.song-body`
    // is the scroll container that fills the whole content pane, and it carried
    // an opaque `--surface`. The blob layer behind it was present, correct and
    // completely invisible: the pane measured exactly [18, 15, 12] - `--surface`
    // to the last channel - everywhere, in every screenshot.
    //
    // Every panel that makes up the window is a veil since phase 35. A fill on
    // any of them is an opaque sheet over the whole window, so the rule is
    // checked rather than remembered.
    const PANES = [".body", ".content", ".song-body", ".sidebar", ".appbar", ".player-bar"];

    for (const pane of PANES) {
      const rule = all.find((entry) => entry.selector.trim().endsWith(pane));
      const declared = /background:\s*var\((--[\w-]+)\)/.exec(rule?.body ?? "");
      if (declared === null) {
        // No fill at all is the safest answer and needs no alpha.
        continue;
      }

      // A veil carries an alpha; `oklch(L C H / A)` is how the token block
      // writes one. An opaque token here is the defect - on either ground,
      // because the blob layer is behind both of them.
      for (const ground of GROUNDS) {
        expect(
          token(String(declared[1]).replace(/^--/, ""), ground),
          `${pane} is opaque on ${ground}`,
        ).toContain("/");
      }
    }
  });

  it("keeps the window's base fill off the element that would hide the blobs", () => {
    // The defect this exists for, and it is worth stating in full because
    // every other test passed while it was live: the blob layer is a fixed
    // child at `z-index: -1`, so it paints in the root's negative-z-index step
    // - after the root background, before every in-flow block. `body` is an
    // in-flow block. A fill on it covered the layer completely, and the two
    // e2e screenshots of "with artwork" and "without artwork" came out
    // pixel-identical in the content area.
    const html = all.find((rule) => /^html$/m.test(rule.selector.trim()));
    const body = all.filter((rule) => /^body$/m.test(rule.selector.trim()));

    expect(html?.body).toMatch(/background:\s*var\(--surface\)/);
    for (const rule of body) {
      expect(rule.body, "a background on `body` hides the blob layer").not.toMatch(/background/);
    }
  });

  it("anchors the blob positions to the window, not to the layer", () => {
    // The layer is 140vmax so the rotation never swings an edge into view,
    // which makes it much larger than the window. A position written as a bare
    // percentage is therefore a percentage of *the layer*: the design's third
    // blob at "82% down" landed 320px below the bottom of a 1080-tall window
    // and was never once visible, and the other two only clipped the top edge.
    // Measured coverage of the pane went from 35-44% to 83-97% once these were
    // expressed as offsets from the centre instead.
    const layer = all.find((rule) => rule.selector.trim().endsWith(".dynamic-bg::before"));
    const positions = [...(layer?.body ?? "").matchAll(/\bat\s+([^,]+?)\s*,/g)].map((match) =>
      (match[1] ?? "").trim(),
    );

    expect(positions).toHaveLength(3);
    for (const position of positions) {
      // `50%` of the layer is the middle of the window whatever its size, so an
      // offset from there is the one form that survives a resize.
      expect(position, `${position} is not anchored to the window`).toMatch(
        /calc\(\s*50%\s*[-+][^)]*v[wh]\s*\)\s+calc\(\s*50%\s*[-+][^)]*v[wh]\s*\)/,
      );
    }
  });

  it("sizes every radial gradient a way the syntax allows", () => {
    // `radial-gradient(circle 34% ...)` is invalid: a circle's radius may be a
    // length, never a percentage. The engine drops the whole `background`
    // declaration, so the blob layer renders and paints nothing - and it is
    // silent, because a stylesheet has no way to complain. `ellipse 34% 34%`
    // is the same shape on a square element and is legal.
    const offenders = [...css.matchAll(/radial-gradient\(\s*circle\s+[\d.]+%/g)].map(
      (match) => match[0],
    );

    expect(offenders).toEqual([]);
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

  it("writes every colour in one file and nowhere else", () => {
    // The reason a second ground was a second column of values rather than an
    // audit of six hundred declarations - and the reason a third would be too.
    // Nothing structural stops a literal being written straight into a
    // component rule, and every one that is written there is a colour that
    // does not change when the ground does: it is how an app grows a theme
    // that is correct everywhere except four places nobody looks at.
    //
    // `tokens.css` is exempt by definition; it is where they belong.
    const literals = SHEETS.slice(1).flatMap((name, index) => {
      const sheet = sources[index + 1] ?? "";
      return [
        ...sheet.matchAll(/(?:#[0-9a-f]{3,8}|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\()/gi),
      ].map(
        (match) => `${match[0]} at ${name}.css:${sheet.slice(0, match.index).split("\n").length}`,
      );
    });

    expect(literals).toEqual([]);
  });

  it("imports the four sheets, in the order the cascade needs", () => {
    // The split is load-bearing three times over. `primitives.css` is bare
    // element selectors that a component rule of equal specificity would win
    // over, so it has to precede the other two; `library.css` is the
    // primitives, which a region in `app.css` has to be able to overrule -
    // `.dialog-list .button` sits in a list row and knows a size `.button`
    // cannot;
    // and `tokens.css` has to precede all of them or every `var()` resolves
    // against nothing. An import reordered by a tidying pass would break the
    // sheet in ways that look like a component bug, so the order is asserted
    // rather than remembered.
    const imported = [...entry.matchAll(/@import\s+"\.\/styles\/([\w-]+)\.css"/g)].map(
      ([, name]) => name,
    );

    expect(imported).toEqual([...SHEETS]);
  });

  it("defines the tokens the rest of the sheet asks for", () => {
    // The other half of the rule above: a rule may only use `var()`, so a
    // `var(--typo)` would silently resolve to nothing rather than to a colour.
    const declared = new Set(declaredTokens);
    // The blob colours are the one exception, and a deliberate one: they hold
    // whatever the playing cover turned out to be, so their value comes from
    // React and their *declaration* is the `@property` block that makes them
    // interpolable. Registered is declared.
    for (const [, name] of css.matchAll(/@property\s+(--[\w-]+)/g)) {
      declared.add(name as string);
    }
    const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name as string));

    // Guards the guard: a regex that matched nothing would compare empty sets.
    expect(declared.size).toBeGreaterThan(15);
    expect([...used].filter((name) => !declared.has(name) && !name.startsWith("--a"))).toEqual([]);
  });

  it("declares every token on both grounds", () => {
    // The failure this exists for is silent in exactly one direction. A token
    // defined on dark and forgotten on light does not throw, does not warn and
    // does not show up in a dark screenshot: the rule simply resolves to
    // nothing on the other ground and the element loses its colour. Nobody
    // reviewing the theme they use would ever see it.
    //
    // Sorted rather than compared as sets, so the failure message names the
    // token instead of saying two sets differ.
    const [light = [], dark = []] = GROUNDS.map((g) => names(blocks[g]).sort());

    // Guards the guard, twice. A selector that matched nothing would compare
    // two empty lists and pass; a selector that matched the *same* block for
    // both grounds would compare a list to itself and pass just as quietly,
    // which is the failure the comment-stripping above exists to prevent.
    expect(light.length).toBeGreaterThan(30);
    expect(token("surface", "light")).not.toBe(token("surface", "dark"));

    expect(light).toEqual(dark);
  });

  it("gives each ground its own colour-scheme", () => {
    // What makes the native widgets - a scrollbar, a native `select`'s popup,
    // a caret - follow the theme. Without it a light app keeps dark
    // scrollbars, which is the one part of the window the app does not paint
    // itself and therefore the one part that gives the whole thing away.
    for (const ground of GROUNDS) {
      expect(blocks[ground], `${ground} sets color-scheme`).toMatch(
        new RegExp(`color-scheme:\\s*${ground}`),
      );
    }
  });

  it("keeps text readable on every surface it is drawn on, on both grounds", () => {
    // A surface added a step too close to the text above it is an easy and
    // invisible mistake, and a second ground doubles the chances of making
    // one: the ramps run in opposite directions, so a value that is safely
    // recessive on dark can be the brightest thing in the room on light.
    // WCAG AA for body text is 4.5:1; these are the pairings the app makes.
    const PAIRS = [
      ["text", "surface"],
      ["text", "chrome"],
      ["text", "field"],
      ["text", "row-odd"],
      ["muted", "surface"],
      ["muted", "chrome"],
      ["muted", "field"],
      ["muted", "sidebar"],
      ["muted", "pill"],
      ["sidebar-text", "sidebar"],
      ["label", "chrome"],
      ["label", "sidebar"],
      ["danger", "surface"],
      ["on-accent", "accent"],
      ["on-danger", "destructive"],
    ];

    const failures = GROUNDS.flatMap((ground) =>
      PAIRS.map(([fore, back]) => ({
        pair: `${fore} on ${back} (${ground})`,
        ratio: contrast(token(fore as string, ground), token(back as string, ground)),
      }))
        .filter((one) => one.ratio < 4.5)
        .map((one) => `${one.pair} = ${one.ratio.toFixed(2)}:1`),
    );

    expect(failures).toEqual([]);
  });

  it("keeps the accent usable as a mark on both grounds", () => {
    // Three defects in phase 108 were one fact: the design's light amber
    // (#e8730f) cannot carry contrast on a light ground. It is 2.73:1 on the
    // content pane, 2.45:1 on the transport pill and 3.05:1 against pure
    // white, which is the ceiling - there is no surface here it can be drawn
    // on. The playing marker and the play button both shipped invisible.
    //
    // Every rule that reaches for `--accent` uses it in a role with a
    // threshold; the washes are their own tokens. So the bar is: 3:1 as a mark
    // (WCAG 1.4.11) on every surface it is drawn on, and 4.5:1 where it is
    // text. The strip is a veil, so it is composited rather than named.
    const failures: string[] = [];
    for (const ground of GROUNDS) {
      const accent = token("accent", ground);
      const strip = [token("strip-veil", ground), token("surface", ground)];

      for (const [role, behind, minimum] of [
        // `.row-status.playing`, and the accent bar on an active nav item.
        ["marker on the content pane", [token("surface", ground)], 3],
        ["marker on a striped row", [token("row-odd", ground)], 3],
        // `.volume-mark`, `.repeat-button[aria-pressed]`.
        ["glyph on the transport strip", strip, 3],
        // The one solid accent fill in the chrome, inside its capsule.
        ["play button on the pill", [token("pill", ground)], 3],
        // `.link-button`, `.statusbar-update`, `.sidebar-dropzone.drop-target`.
        ["link on the content pane", [token("surface", ground)], 4.5],
        ["link in a dialog", [token("chrome", ground)], 4.5],
        ["link on the sidebar", [token("sidebar", ground)], 4.5],
      ] as [string, string[], number][]) {
        const ratio = contrastOver(accent, behind);
        if (ratio < minimum) {
          failures.push(`${role} (${ground}) = ${ratio.toFixed(2)}:1, wanted ${minimum}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("takes the muted columns back to ink on a selected row", () => {
    // Every column but the title is `--muted` now, after the sheet. Over
    // `--accent-tint` that is 4.16:1 on dark - under AA for body text - so the
    // selected row has to take it back, the same way it takes back the row
    // markers above. Both halves are asserted: that the rule is there, and
    // that what it lands on clears the bar.
    const override = all.find((rule) =>
      rule.selector.trim().endsWith(".song-row.selected .song-cell[data-column]"),
    );

    expect(override?.body, "a selected row must override the muted column").toMatch(
      /color:\s*inherit/,
    );

    for (const ground of GROUNDS) {
      const row = [token("accent-tint", ground), token("surface", ground)];

      expect(
        contrastOver(token("text", ground), row),
        `a column on the selected row (${ground})`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps a slider's rail visible against the strip it sits on", () => {
    // WCAG 1.4.11 asks 3:1 of the parts of a control needed to understand it,
    // and a slider whose extent you cannot see is exactly that. Measured
    // against the *composited strip* rather than against the rail's own fill:
    // the rail shipped at 2.97:1 there while clearing 2.36:1 against its fill,
    // which is the pair this file used to check and the wrong one.
    //
    // Either edge may carry it, as in the e2e suite: a rail can be legible
    // through its fill or through the border drawn around it.
    for (const ground of GROUNDS) {
      const behind = [token("strip-veil", ground), token("surface", ground)];
      const best = Math.max(
        contrastOver(token("track", ground), behind),
        contrastOver(token("track-border", ground), behind),
      );

      expect(best, `the rail on ${ground}`).toBeGreaterThan(3);
    }
  });

  it("keeps the search field's clear affordance legible on both grounds", () => {
    // Its own assertion at its own threshold, and the comment is the point.
    // `.search-clear` is the only text the app draws on `--skeleton`, and on
    // the light ground `--muted` on it is 4.22:1 - short of AA for body text.
    // Nothing can fix that here: lifting `--skeleton` to reach 4.5 puts it
    // within 1.02:1 of the field it sits inside, which is the invisible-border
    // defect in a different place.
    //
    // It is a glyph on a button rather than prose, so WCAG 1.4.11 at 3:1 is
    // the bar it is actually held to. Stated explicitly so that the number is
    // a decision rather than an oversight.
    for (const ground of GROUNDS) {
      expect(
        contrast(token("muted", ground), token("skeleton", ground)),
        `search-clear on ${ground}`,
      ).toBeGreaterThan(3);
    }
  });

  it("never fills with the accent under anything but its own ink", () => {
    // This is the pairing the redesign had to correct: white on the dark
    // ground's amber is 2.46:1, and it was the fill behind the *selected row* -
    // the surface a library is read on. Selection uses `--accent-tint`
    // instead, and a solid accent fill may only carry `--on-accent`.
    //
    // The numeric half of this used to read `text on accent < 4.5`, which was
    // true only by coincidence of the dark ground: light's ink *does* read on
    // its accent, at 5.45:1, and `--on-accent` is that same ink. So the rule
    // that actually holds on both grounds is the one asserted here - the
    // named token is legible - and the structural check below is what stops
    // anything else being used in its place.
    // All three weights of fill since phase 110: the primary button changes
    // colour under the pointer and under the press, and a hover state that
    // took the label below AA would be a defect nobody screenshots.
    for (const ground of GROUNDS) {
      for (const fill of ["accent", "accent-hover", "accent-active"]) {
        expect(
          contrast(token("on-accent", ground), token(fill, ground)),
          `on-accent on ${fill} (${ground})`,
        ).toBeGreaterThan(4.5);
      }
    }

    const fills = all
      .filter((rule) => /background:\s*var\(--accent(?:-hover|-active)?\)/.test(rule.body))
      // Anchored, or `border-color: var(--accent)` reads as a foreground and
      // every accent-bordered button is a false positive.
      .filter((rule) => /(?:^|[;{\s])color:\s*var\(--(?!on-accent)/.test(rule.body))
      .map((rule) => rule.selector);

    expect(fills).toEqual([]);
  });

  it("keeps a label on one of the accent's own washes readable", () => {
    // The other half of the pair above, and the reason `--accent-deep`
    // exists. A ghost button, a selection-filled tag and a toggled icon
    // button all draw the accent as *text on a wash of itself*, and a wash
    // over a light ground moves the surface toward the ink on it - so the
    // step that clears 4.5:1 on the bare ground does not clear it on its own
    // highlight. Light needs a deeper accent for this; dark does not, and
    // declares the same value under the shared name.
    //
    // Nine pairs per ground: three washes over the three surfaces a button or
    // a tag is drawn on. `--field` is not one of them - it is an inset
    // control, and nothing puts a button inside one.
    const washes = ["accent-tint", "accent-veil", "accent-veil-strong"];
    const behind = ["surface", "chrome", "sidebar"];

    // Guards the guard. A name misspelt here resolves to the empty string,
    // which `linearSrgb` reads as black - and black on a light wash passes
    // every assertion below while measuring nothing.
    for (const name of ["accent-deep", ...washes, ...behind]) {
      for (const ground of GROUNDS) {
        expect(token(name, ground), `--${name} on ${ground}`).not.toBe("");
      }
    }

    for (const ground of GROUNDS) {
      for (const wash of washes) {
        for (const under of behind) {
          expect(
            contrastOver(token("accent-deep", ground), [token(wash, ground), token(under, ground)]),
            `accent-deep on ${wash} over ${under} (${ground})`,
          ).toBeGreaterThan(4.5);
        }
      }
    }
  });

  it("takes the focus ring back on the one fill it is invisible on", () => {
    // `:focus-visible` is `outline: 2px solid var(--accent)` at
    // `outline-offset: -2px`, which is inside the box - so on a primary
    // button it is the accent drawn on the accent. Every other control in the
    // app has a ring that contrasts with what it sits on; this is the one
    // that has to say otherwise, and it is invisible rather than merely
    // subtle, which is why it is asserted rather than left to a screenshot.
    const primary = all.find((one) =>
      one.selector.trim().endsWith(".button.primary:focus-visible"),
    );

    expect(primary?.body, "a primary button's ring must not be its own fill").toMatch(
      /outline-color:\s*var\(--on-accent\)/,
    );

    // The same problem on a selected segment, which is the other accent fill
    // a focus ring can land on. Phase 111.
    const segment = all.find((one) =>
      one.selector.trim().endsWith(".segment:has(input:checked) input:focus-visible"),
    );

    expect(segment?.body, "a selected segment's ring must not be its own fill").toMatch(
      /outline-color:\s*var\(--on-accent\)/,
    );
  });

  it("keeps every mark of a drawn control findable", () => {
    // Phase 111 replaced the native checkbox, radio and select, and a drawn
    // control has to earn by hand what the engine used to supply. WCAG 1.4.11
    // asks 3:1 of the visual information required to identify a component and
    // its state, and for three of these the mark *is* the whole control: an
    // unticked 15px box, an unselected radio, a switch that is off. The
    // sheet's own line for all three is `--field-border`, which is 2.58:1 on
    // light and 2.57:1 on dark - fine behind a field's fill and its text,
    // nowhere near enough on an empty box - so they take `--track-border`.
    //
    // Four surfaces, because a dialog, the sidebar and a field are all places
    // one of these is drawn.
    const behind = ["surface", "chrome", "field", "sidebar"];

    // Guards the guard: a name misspelt below resolves to the empty string,
    // which `linearSrgb` reads as black, and black passes on a light ground
    // while measuring nothing.
    for (const name of ["track-border", "rail", "muted", "accent", "text", ...behind]) {
      for (const ground of GROUNDS) {
        expect(token(name, ground), `--${name} on ${ground}`).not.toBe("");
      }
    }

    for (const ground of GROUNDS) {
      for (const under of behind) {
        // An unticked box's edge and a switch's off track, which is the same
        // token doing the same job.
        expect(
          contrast(token("track-border", ground), token(under, ground)),
          `track-border on ${under} (${ground})`,
        ).toBeGreaterThan(3);
        // A selected radio's ring and dot, and a slider's fill.
        expect(
          contrast(token("accent", ground), token(under, ground)),
          `accent on ${under} (${ground})`,
        ).toBeGreaterThan(3);
        // A slider's knob, which is what says where the value is.
        expect(
          contrast(token("text", ground), token(under, ground)),
          `text on ${under} (${ground})`,
        ).toBeGreaterThan(3);
      }

      // The knob that says which way a switch is thrown, on the track it
      // sits on. The sheet draws this one in the ground's own colour on
      // light, where it is 1.62:1 and the state cannot be read at all; both
      // grounds take `--muted`, which is the sheet's own dark-column answer.
      expect(
        contrast(token("muted", ground), token("rail", ground)),
        `a switch's off knob on its own track (${ground})`,
      ).toBeGreaterThan(3);

      // A tick, a mixed bar, a thrown switch's knob - every mark drawn on an
      // accent fill rather than beside one.
      expect(
        contrast(token("on-accent", ground), token("accent", ground)),
        `a mark on the accent fill (${ground})`,
      ).toBeGreaterThan(3);
    }
  });

  it("replaces every focus ring a drawn control turns off", () => {
    // A drawn control hides its own input, so the ring the global rule would
    // have put on that input is dropped and re-drawn on the mark beside it.
    // The `outline: none` and its replacement are two different selectors -
    // exactly the kind of pair a later edit separates - and the first alone
    // is an accessibility bug.
    //
    // Found by the thing that makes one: a rule that takes an input's opacity
    // to zero. A text field that drops the ring in favour of a `:focus`
    // border is a different bargain, keeps a visible element to put one on,
    // and has its own rules in `app.css`.
    //
    // `uncommented`, because `rules()` sweeps the comment above a rule into
    // its selector, and more than one of them explains itself by naming
    // `:focus-visible`.
    const owner = /\.([\w-]+)\s+input(?::focus-visible)?$/;
    const components = (pattern: RegExp, body: RegExp) =>
      all
        .map((rule) => ({ selector: uncommented(rule.selector), body: rule.body }))
        .filter((rule) => body.test(rule.body))
        .flatMap((rule) => rule.selector.split(","))
        .map((one) => pattern.exec(one.trim())?.[1])
        .filter((name) => name !== undefined);

    const hidden = new Set(components(owner, /opacity:\s*0\s*[;}]?\s*$/m));
    const dropped = components(owner, /outline:\s*none/).filter((name) => hidden.has(name));

    expect(dropped, "the drawn controls that hide their own input").not.toEqual([]);

    for (const component of dropped) {
      const replacement = all.find(
        (rule) =>
          uncommented(rule.selector).includes(`.${component} input:focus-visible ~ `) &&
          /outline:\s*\d/.test(rule.body),
      );

      expect(replacement, `nothing draws a ring for .${component}`).toBeDefined();
    }
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

  it("gives the player bar a fixed height, not a growing one", () => {
    // The layout shift this pins shut used to be inside the now-playing box:
    // idle showed one line, playing showed three plus a scrubber, and the box
    // grew the moment a song started. Phase 35 fixed that by construction -
    // the playhead is its own control and the box always shows the same shape
    // - so what has to hold now is the bar itself, which every one of those
    // controls is measured against.
    //
    // `selector` carries any comment that preceded the rule, so these match
    // the tail rather than the whole string.
    const strip = all.find((one) => /(^|\s)\.player-bar$/.test(one.selector));

    expect(strip).toBeDefined();
    expect(strip?.body).toMatch(/[^-]height:\s*\d/);
    expect(strip?.body).not.toMatch(/min-height/);

    // And the cover, which is the tallest thing on it: a thumbnail sized to
    // whatever image the file happened to carry would resize the strip.
    const cover = all.find((one) => /(^|\s)\.now-playing-cover$/.test(one.selector));

    expect(cover?.body).toMatch(/[^-]height:\s*\d/);
    expect(cover?.body).toMatch(/object-fit:\s*cover/);
  });

  it("sizes the tag editor's artwork rather than letting the file decide", () => {
    // Same failure as the strip's thumbnail, somewhere it is worse: an
    // embedded cover can be 3000px square, and drawn at its intrinsic size it
    // pushes the dialog past `.dialog`'s `max-height` and turns it into a
    // scroll area. The box states its size and crops to it.
    const art = all.find((one) => /(^|\s)\.tag-cover-art$/.test(one.selector));

    expect(art).toBeDefined();
    expect(art?.body).toMatch(/[^-]width:\s*\d/);
    expect(art?.body).toMatch(/[^-]height:\s*\d/);
    expect(art?.body).toMatch(/object-fit:\s*cover/);
  });

  it("gives a paned dialog one size, and every scroller inside it a floor", () => {
    // The lookup passed through six heights - 154px reading the files, 695px
    // confirming eleven - and it is centred, so every one of them moved both
    // edges under the pointer resting on the actions. What fixed it was the
    // box stating a height, not the count of scroll areas inside it: a column
    // that scrolls within a fixed track moves nothing.
    //
    // So the rule this asserts is the one that was always the point. The box
    // states a height, `.dialog-body` is the default scroller, and anything
    // that scrolls in its place states `min-height: 0` - without which a grid
    // or flex child's automatic minimum is its content, the column grows to
    // fit and the footer is on the move again.
    const paned = all.find((one) => /(^|\s)\.dialog\.paned$/.test(one.selector));
    const body = all.find((one) => /(^|\s)\.dialog\.paned > \.dialog-body$/.test(one.selector));

    expect(paned?.body).toMatch(/overflow:\s*hidden/);
    expect(body?.body).toMatch(/overflow-y:\s*auto/);
    expect(body?.body).toMatch(/min-height:\s*0/);
    expect(body?.body).toMatch(/flex:\s*1/);

    const lookup = all.find((one) => /(^|\s)\.dialog\.lookup$/.test(one.selector));

    expect(lookup?.body, ".dialog.lookup should state a height").toMatch(/[^-]height:\s*max\(/);

    // 118 put the queue in a column beside the pane, so the body hands the
    // scroll to its two children rather than keeping it. Deliberate, and
    // stated here so that a third region quietly taking it is not.
    const lookupBody = all.find((one) =>
      /(^|\s)\.dialog\.lookup > \.dialog-body$/.test(one.selector),
    );

    expect(lookupBody?.body, "the lookup's body hands the scroll to its columns").toMatch(
      /overflow:\s*hidden/,
    );

    const inside = all.filter(
      (one) => /(^|\s)\.lookup[\w-]*$/.test(one.selector) && !one.selector.includes(".dialog"),
    );

    // Counted, so that a selector this stops matching fails here rather than
    // quietly emptying the loop below.
    expect(inside.length).toBeGreaterThan(8);
    const scrollers = inside.filter((one) => /overflow(-y)?:\s*(auto|scroll)/.test(one.body));

    // The queue's list and the pane - the two columns the body gave the
    // scroll to - and the candidates, which the pane caps at five.
    // `uncommented`, because `rules()` sweeps whatever precedes the brace -
    // comments included - into the selector.
    expect(scrollers.map((one) => uncommented(one.selector).trim())).toEqual([
      ".lookup-queue-list",
      ".lookup-pane",
      ".lookup-results",
    ]);
    for (const rule of scrollers) {
      expect(rule.body, `${rule.selector} scrolls without a floor`).toMatch(/min-height:\s*0/);
    }
    // `overflow: hidden` for truncation is how the queue's album and the
    // mapping's titles ellipsise, so it stays allowed; a scroller is not.
    for (const rule of inside) {
      expect(rule.body, `${rule.selector} scrolls sideways`).not.toMatch(
        /overflow-x:\s*(auto|scroll)/,
      );
    }
  });

  it("keeps the dialog's own chrome out of `app.css`", () => {
    // The point of pulling the shell out of eight dialogs is that a ninth
    // cannot quietly draw a different one. A region may say how wide its
    // dialog is, how tall, and how the things inside it sit - `.dialog.lookup`
    // states a height, `.dialog.settings` a grid - but the edge, the inset and
    // the shadow are the primitive's, and a rule here that restates one of
    // them is the drift this exists to catch.
    //
    // `border-*` and `padding-*` on a region *inside* a dialog are none of
    // this rule's business, so it only looks at selectors that name the box.
    const chrome = rules(sources[3] ?? "").filter((one) =>
      /\.dialog(\.[\w-]+)*\s*$/.test(uncommented(one.selector)),
    );

    // Counted, so that a rename here fails rather than emptying the loop.
    expect(chrome.length).toBeGreaterThanOrEqual(3);
    for (const rule of chrome) {
      expect(rule.body, `${rule.selector} draws chrome the primitive owns`).not.toMatch(
        /(^|;|\s)(border|padding|box-shadow|background):/,
      );
    }
  });

  it("keeps the stat figures' own drawing out of `app.css`", () => {
    // Sections 4a, 4c, 4d and 4e are where the figures on this app's stat
    // surfaces are settled - the sizes, the weights, the rule, the cell edges,
    // the streak's track, the heatmap's 13px cell and the ranked row's 30px -
    // and the Statistics view is the only place any of them appears. A rule
    // here would be a private second drawing that no other caller of the
    // primitive gets, which is the drift 113 pulled the dialog shell out of
    // eight dialogs to stop.
    //
    // Not even layout: the two-column override Streaks needed went with the
    // tiles it narrowed, so the region names none of these at all. A region
    // that later has a real reason to overrule one of them relaxes this with
    // the reason written down, rather than finding the door already open.
    //
    // `.chart-intrinsic` is not on this list and belongs where it is: it is
    // the shell around the grid rather than the grid, and it is the other half
    // of `.chart`'s fixed height, which app.css states three lines above it.
    const drawn = rules(sources[3] ?? "")
      .map((one) => uncommented(one.selector))
      .filter((selector) => /\.(stat-(row|tiles?|unit)|streak|heatmap|bar-list)\b/.test(selector));

    expect(drawn).toEqual([]);
  });

  it("keeps the menus' and the task line's own drawing out of `app.css`", () => {
    // Section 05 is one drawing for both menus in the app and for the readout
    // at the foot of the sidebar. `.sidebar-task` says where that readout
    // goes - the foot of the sidebar is the app's decision, not the
    // primitive's - and says nothing about what it looks like, which is the
    // split 113 drew for the dialogs and 115 for the figures.
    const drawn = rules(sources[3] ?? "")
      .map((one) => uncommented(one.selector))
      .filter((selector) => /\.(menu-[\w-]+|task-line|progress)\b/.test(selector));

    expect(drawn).toEqual([]);

    const placement = rules(sources[3] ?? "").find(
      (one) => uncommented(one.selector).trim() === ".sidebar-task",
    );

    expect(placement, ".sidebar-task should still place the readout").toBeDefined();
    expect(placement?.body, ".sidebar-task draws what `TaskLine` owns").not.toMatch(
      /(^|;|\s)(color|font|font-size|line-height|background|border|box-shadow):/,
    );
  });

  it("paints every ramp step either mark can ask for, and no more", () => {
    // `rampStep` returns 0 through `RAMP_STEPS`, and a step with no rule is a
    // mark drawn as nothing at all - on a heatmap that is indistinguishable
    // from a quiet hour, and on a donut from a genre a filter emptied. The
    // ramp went from four steps to seven in 116b, which is three files: the
    // constant, the tokens, and a rule per step per mark. This is what says
    // so, rather than a screenshot somebody has to look at closely.
    //
    // Both ends are asserted. A ramp left one token longer than the quantizer
    // is a colour nothing can reach, which is how the two drift apart in the
    // other direction.
    for (let step = 0; step <= RAMP_STEPS; step += 1) {
      expect(declaredTokens, `the ramp declares step ${step}`).toContain(`--chart-ramp-${step}`);
      for (const mark of [".chart-slice", ".heatmap-cell"]) {
        const rule = `${mark}[data-step="${step}"]`;
        expect(
          all.some((one) => uncommented(one.selector).trim() === rule),
          `${rule} is drawn`,
        ).toBe(true);
      }
    }

    expect(declaredTokens).not.toContain(`--chart-ramp-${RAMP_STEPS + 1}`);
  });

  it("draws the heatmap's loading grid as wide as the loaded one", () => {
    // The loading plot centres its child with flex, and a grid of
    // `minmax(0, 1fr)` cells with no width of its own shrinks to its labels.
    const heatmap = all.find((one) => uncommented(one.selector).trim() === ".heatmap");

    expect(heatmap?.body, ".heatmap should fill the plot").toMatch(/(^|;|\s)width:\s*100%/);
  });

  it("gives Settings one size and one scroller too", () => {
    // A category with eight watch folders is taller than one with two rows,
    // and the rail and Done should not move between them. `overflow: hidden`
    // stays allowed - it is how a long path truncates, not a scroll area.
    const settings = all.find((one) => /(^|\s)\.dialog\.settings$/.test(one.selector));

    expect(settings?.body, ".dialog.settings should state a height").toMatch(/[^-]height:\s*min\(/);

    const inside = all.filter((one) => /\.settings-[\w-]+/.test(one.selector));

    expect(inside.length).toBeGreaterThan(8);
    for (const rule of inside) {
      expect(rule.body, `${rule.selector} would be a second scroller`).not.toMatch(
        /overflow(-y)?:\s*(auto|scroll)/,
      );
      expect(rule.body, `${rule.selector} caps a height the pane scrolls`).not.toMatch(
        /max-height/,
      );
    }
  });

  it("keeps the app bar and the footer the heights the design draws", () => {
    // Both are stated rather than left to their contents, and both are what
    // the player bar and the content pane are measured against. A bar
    // that sized itself would move every time a version string got a digit
    // longer or a menu label changed.
    for (const [selector, height] of [
      [".appbar", 40],
      [".statusbar", 30],
    ] as const) {
      const rule = all.find((one) => one.selector.trim().endsWith(selector));
      expect(rule?.body, `${selector} should state its height`).toMatch(
        new RegExp(`[^-]height:\\s*${height}px`),
      );
    }
  });

  it("pads a header and a cell by the same amount a fitted width assumes", () => {
    // `CELL_PADDING_PX` in `columnDrag.ts` is what double-clicking a divider
    // adds to the widest text it measured. It is one number for both because
    // both are 6px a side; change either here and the fit clips or gaps.
    for (const selector of [".song-header-cell", ".song-cell"]) {
      const rule = all.find((one) => one.selector.trim().endsWith(selector));

      expect(rule?.body, `${selector} should state its padding`).toMatch(
        /padding:\s*\S+\s+6px\s*;/,
      );
    }
  });

  it("keeps a header and a cell on one line, which is what a fit measures", () => {
    // A fit takes the widest line of each; a header allowed to wrap measures
    // its longest word and is fitted to stay wrapped.
    for (const selector of [".song-header-cell", ".song-cell"]) {
      const rule = all.find((one) => one.selector.trim().endsWith(selector));

      expect(rule?.body, `${selector} should not wrap`).toMatch(/white-space:\s*nowrap\s*;/);
    }
  });

  it("keeps the drill-in header inside the pane it is inset into", () => {
    // The header table is also a `.song-table`, whose `min-width: 100%` sits
    // later in the sheet. Winning on order alone, it added the gutter inset
    // on top of a full pane width and scrolled every drill-in sideways.
    const candidates = all
      .map((rule, order) => ({
        selector: (rule.selector.split("*/").pop() ?? "").trim(),
        body: rule.body,
        order,
      }))
      .filter(
        (rule) =>
          [".song-table", ".release-header-table", ".song-table.release-header-table"].includes(
            rule.selector,
          ) && /min-width:/.test(rule.body),
      );
    const specificity = (selector: string) => selector.split(".").length - 1;
    const winner = candidates.reduce((a, b) =>
      specificity(b.selector) > specificity(a.selector) ||
      (specificity(b.selector) === specificity(a.selector) && b.order > a.order)
        ? b
        : a,
    );

    expect(winner.body).toMatch(/min-width:\s*calc\(100% - /);
  });

  it("leaves no caption buttons behind", () => {
    // Phase 119 handed the frame back to the OS. The rules that drew the
    // minimise, maximise and close glyphs are the one part of the old title
    // bar with no equivalent under a native frame, so their absence is checked
    // rather than remembered - a reinstated `.window-buttons` would be a
    // second set of window controls beside the real ones.
    expect(css).not.toMatch(/\.window-buttons/);
    // The separator can be an ordinary border again. It was an inset shadow
    // only because the close button's red hover fill had to paint over it.
    const appbar = all.find((one) => one.selector.trim().endsWith(".appbar"));

    expect(appbar?.body).toMatch(/border-bottom:\s*1px solid var\(--chrome-border\)/);
  });

  it("blurs behind every translucent panel of chrome", () => {
    // The panels are veils rather than fills so that phase 39's cover colours
    // can drift behind them. A veil with no blur under it is just a slightly
    // wrong colour - and worse, it lets whatever is behind it show through
    // sharply, which is how translucent chrome turns text unreadable.
    // The three blurred panels by name. `--hover-veil` is not one of them: it
    // is the lift a button gives under the pointer, painted on top of chrome
    // rather than being chrome. Nor is `--content-wash`, which is a
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
    // Named as phase 24 spelled them; 117 renamed the family to `.menu-*`,
    // and neither of these came back under either spelling.
    for (const selector of [".context-row", ".context-submenu", ".menu-row", ".menu-submenu"]) {
      const rule = all.find((one) => one.selector.trim().endsWith(selector));
      expect(rule, `${selector} should have gone with the hand-rolled menu`).toBeUndefined();
    }
  });

  it("positions every portalled overlay itself", () => {
    // The bug this exists for: `.dialog` was centred by being a flex child of
    // `.dialog-backdrop`. Base UI renders the two as siblings in a portal, so
    // the dialog fell into normal flow at the end of the body and drew below
    // the footer. Nothing could have caught it in a component test - jsdom
    // applies no stylesheet - and the app still passed 630 of them.
    //
    // Anything the app portals to the body has to carry its own position.
    //
    // Matched exactly rather than by suffix: `.icon-button.in-dialog` ends in
    // a word this list also holds, and a suffix match found *it* instead and
    // asserted that a 36px square positions itself.
    const overlays = [
      ".dialog",
      ".dialog-backdrop",
      ".menu-positioner",
      ".select-positioner",
      ".suggest-positioner",
      ".drag-badge",
    ];
    for (const selector of overlays) {
      const rule = all.find((one) => uncommented(one.selector).trim() === selector);

      expect(rule, `${selector} should exist`).toBeDefined();
      expect(rule?.body, `${selector} must position itself`).toMatch(/position:\s*fixed|z-index:/);
    }

    // And the dialog has to sit above its own backdrop, not merely somewhere.
    const dialog = all.find((one) => uncommented(one.selector).trim() === ".dialog");
    const backdrop = all.find((one) => uncommented(one.selector).trim() === ".dialog-backdrop");
    const layer = (body: string | undefined) => Number(/z-index:\s*(\d+)/.exec(body ?? "")?.[1]);

    expect(layer(dialog?.body)).toBeGreaterThan(layer(backdrop?.body));

    // A popup that opens from a field inside a dialog is a sibling of it in
    // the body, so it layers above the dialog only by number. The select sat
    // at 10 against the dialog's 11 from #239 to 127: open, keyboard-live,
    // and drawn underneath.
    for (const selector of [".select-positioner", ".suggest-positioner"]) {
      const rule = all.find((one) => uncommented(one.selector).trim() === selector);

      expect(layer(rule?.body), `${selector} must open above .dialog`).toBeGreaterThan(
        layer(dialog?.body),
      );
    }
  });

  it("keeps the drag badge out of the pointer's way", () => {
    // Load-bearing rather than tidy. The badge follows the pointer, so without
    // this it is the element every `pointermove` and every `pointerup` is
    // delivered to - which is every drop target in the window swallowed at
    // once, and a drag that can never be dropped. jsdom applies no stylesheet,
    // so nothing in a component test would notice.
    const badge = all.find((one) => one.selector.trim().endsWith(".drag-badge"));

    expect(badge?.body).toMatch(/pointer-events:\s*none/);
  });

  it("highlights menu items from state rather than from :hover", () => {
    // Stricter than before, and able to be: the pointer and the keyboard both
    // set `data-highlighted`, so the menu no longer needs the hover exception
    // that `HOVER_ALLOWED` grants it - and a `:hover` rule would now fight the
    // keyboard, lighting up two rows at once.
    const hovered = all
      .filter((rule) => rule.selector.includes(".menu-item"))
      .filter((rule) => rule.selector.includes(":hover"))
      .map((rule) => rule.selector);

    expect(hovered).toEqual([]);
    expect(css).toMatch(/\.menu-item\[data-highlighted\]/);
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
    // that only clears one of the two still leaves an edge missing. Both
    // grounds, because this is exactly the kind of value that is tuned on the
    // theme its author uses and left to chance on the other.
    for (const ground of GROUNDS) {
      expect(
        contrast(token("field-border", ground), token("field", ground)),
        `border vs field (${ground})`,
      ).toBeGreaterThan(2);
      expect(
        contrast(token("field-border", ground), token("chrome", ground)),
        `border vs dialog (${ground})`,
      ).toBeGreaterThan(2);
      expect(
        contrast(token("track-border", ground), token("track", ground)),
        `border vs track (${ground})`,
      ).toBeGreaterThan(2);
    }

    // And the fields must actually use it rather than the chrome divider.
    // `.dialog select` was the other half of this rule until phase 111 drew the
    // select itself; `.select` in `library.css` is where its edge lives now.
    const named = (selector: string) =>
      all.find((rule) => uncommented(rule.selector).trim() === selector)?.body;

    expect(named(".dialog input")).toMatch(/border:[^;]*var\(--field-border\)/);
    expect(named(".select,\n.search-field")).toMatch(/border:[^;]*var\(--field-border\)/);
  });

  it("rounds no corner anywhere in the sheet", () => {
    // Phase 109 took out all 48 of them, from 2px on a badge to 50% on the
    // play button. The rule the library states is "radius 0 everywhere, no
    // exceptions" - structure is carried by rules and alignment - and the way
    // that rule dies is one control at a time, each with a reason of its own.
    //
    // The raw source rather than the parsed rules: a radius reintroduced
    // inside a nested block is the same regression, and `rules()` cannot see
    // in there. `border-radius: 0` stays legal - it is how a UA style gets
    // reset, which is the opposite of the thing being guarded.
    const rounded = [...css.matchAll(/border-radius:\s*([^;}]+)/g)]
      .map((match) => (match[1] ?? "").trim())
      .filter((value) => !/^0[a-z%]*$/.test(value));

    expect(rounded, "radius 0 everywhere, no exceptions").toEqual([]);
  });

  it("draws everything in one face, and figures in tabular ones", () => {
    // The inverse of the guard phases 33-106 carried. Study 7a is one face
    // doing all of it, so a second *text* family reappearing anywhere is the
    // regression. Two stacks are not text and are not the old split coming
    // back: a backtrace is code and stays monospaced, and the caption buttons
    // draw OS glyphs rather than letters.
    const families = all
      .flatMap((rule) => [...rule.body.matchAll(/font-family:\s*([^;]+)/g)])
      .map((match) => (match[1] ?? "").trim())
      .filter((family) => !family.startsWith("ui-monospace"))
      .filter((family) => !family.startsWith('"Segoe MDL2 Assets"'));

    expect(families.length).toBeGreaterThan(0);

    for (const family of families) {
      expect(family, "only Archivo draws text").toMatch(/^Archivo,/);
    }

    const root = all.find((rule) => rule.selector.trim().endsWith(":root"));

    expect(root?.body).toMatch(/font-family:\s*Archivo,/);
    expect(css, "--font-numeric went with Space Grotesk").not.toMatch(/--font-numeric/);

    // Figures are the prose face now, so the only thing keeping a column of
    // them from shifting is the numeric variant. Every element drawing one has
    // to ask for it.
    for (const selector of [
      ".appbar-version",
      ".scrubber-time",
      ".sidebar-count",
      ".song-cell.right",
      ".statusbar-zoom-value",
      ".stat-row dd",
      ".stat-tile-value",
      ".bar-list-value",
      ".count",
    ]) {
      const rule = all.find((one) => one.selector.trim().endsWith(selector));

      expect(rule?.body, `${selector} draws figures and should set tabular-nums`).toMatch(
        /font-variant-numeric:\s*tabular-nums/,
      );
    }
  });
});
