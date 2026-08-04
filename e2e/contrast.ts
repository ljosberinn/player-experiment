/**
 * WCAG contrast, computed in the test process from what the engine returned.
 *
 * Shared by the specs that measure colour rather than duplicated in each: the
 * two of them disagreeing about what 4.5:1 means is the one failure mode a
 * contrast assertion cannot report on itself.
 */

/**
 * One computed colour, as sRGB channels 0-255 plus alpha.
 *
 * Two notations, because the engine hands back whichever the stylesheet was
 * written in. Legacy colours serialize as `rgb()` / `rgba()`; a colour authored
 * in a CSS Color 4 space keeps that space, so since phase 33 most of this app
 * computes to `oklch(L C H)` or `oklch(L C H / A)`.
 *
 * That distinction is not academic. The first version of this file read three
 * numbers out of whatever string arrived, which against `oklch(0.94 0.005 55)`
 * gave channels of 0.94, 0.005 and 55 - and two colours mangled the same way
 * both landed near black, so every ratio came out at exactly 1.00:1 and the
 * suite reported that nothing anywhere was legible.
 */
function parse(colour: string): [number, number, number, number] {
  const parts = (colour.match(/[\d.]+/g) ?? []).map(Number);

  if (!colour.trimStart().toLowerCase().startsWith("oklch")) {
    const [r = 0, g = 0, b = 0, alpha = 1] = parts;
    return [r, g, b, alpha];
  }

  // oklch -> oklab -> LMS -> linear sRGB -> gamma-encoded sRGB, per CSS Color 4.
  const [L = 0, C = 0, H = 0, alpha = 1] = parts;
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);

  const long = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const [red, green, blue] = [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ].map((channel) => {
    const clamped = Math.min(1, Math.max(0, channel));
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return encoded * 255;
  }) as [number, number, number];

  return [red, green, blue, alpha];
}

/** Relative luminance for a colour `getComputedStyle` returned. */
export function luminance(colour: string): number {
  const [r, g, b] = parse(colour);
  const linear = [r, g, b]
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

/**
 * Flattens a stack of fills into the one colour an eye actually sees.
 *
 * Necessary since phase 33, and the reason it is: selection and menu highlights
 * are an 18% wash of the accent over whatever is behind them, not a fill. A
 * translucent layer measured on its own reports as fully opaque - which would
 * have judged the selected row's text against solid amber at 2.18:1 and failed
 * a row that really renders at 12.18:1.
 *
 * `layers` runs front to back, as painting order sees it. Anything still
 * translucent once the last layer is painted is composited over black, which is
 * what a browser does against the page canvas. Compositing happens in sRGB
 * rather than linear light, because that is where a browser does it - the same
 * stack flattened in linear light gives 7.48:1, which is plausible and wrong.
 */
export function flatten(layers: string[]): string {
  let [r, g, b] = [0, 0, 0];
  // Back to front, each layer painted over the accumulated result.
  for (const layer of [...layers].reverse()) {
    const [lr, lg, lb, alpha] = parse(layer);
    r = lr * alpha + r * (1 - alpha);
    g = lg * alpha + g * (1 - alpha);
    b = lb * alpha + b * (1 - alpha);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

/** The ratio between two colours, always >= 1 whichever way round they came. */
export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/**
 * A note on the walkers that feed `flatten`.
 *
 * They stay written out inside each spec's `browser.execute` body rather than
 * being shared from here. `execute` ships the one function it is given and
 * nothing else, so an import is not in scope inside the page - a helper here
 * could only be shared as a string to be eval'd, which trades ten readable
 * lines for a layer of quoting. What matters is shared: the arithmetic is.
 *
 * Each collects *every* fill up to the root rather than stopping at the first
 * opaque one. Deciding what counts as opaque needs the notation-aware parser
 * that only exists out here, and extra layers behind an opaque one cost
 * nothing - painting them changes no pixel.
 */

/** WCAG AA for body text. */
export const TEXT_MINIMUM = 4.5;

/**
 * WCAG 1.4.11, for the parts of a control or a graphic needed to understand
 * it. The playing marker and the slider rails are judged against this.
 */
export const GRAPHIC_MINIMUM = 3;
