/**
 * WCAG contrast, computed in the test process from what the engine returned.
 *
 * Shared by the specs that measure colour rather than duplicated in each: the
 * two of them disagreeing about what 4.5:1 means is the one failure mode a
 * contrast assertion cannot report on itself.
 */

/** Relative luminance for an `rgb(...)` string `getComputedStyle` returned. */
export function luminance(colour: string): number {
  const [r = 0, g = 0, b = 0] = (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const linear = [r, g, b]
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

/**
 * Flattens a stack of fills into the one colour an eye actually sees.
 *
 * Necessary since phase 33, and the reason it is: selection and menu highlights
 * are an 18% wash of the accent over whatever is behind them, not a fill.
 * `luminance` above reads only the first three components, so a translucent
 * layer measured on its own reports as fully opaque - which would have judged
 * the selected row's text against solid amber at 2.60:1 and failed a row that
 * is really 7.48:1.
 *
 * `layers` runs front to back, as painting order sees it. The last one should
 * be opaque; anything still translucent at the end is composited over black,
 * which is what a browser does against the page canvas.
 */
export function flatten(layers: string[]): string {
  let [r, g, b] = [0, 0, 0];
  // Back to front, each layer painted over the accumulated result.
  for (const layer of [...layers].reverse()) {
    const [lr = 0, lg = 0, lb = 0, alpha = 1] = (layer.match(/[\d.]+/g) ?? []).map(Number);
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

/** WCAG AA for body text. */
export const TEXT_MINIMUM = 4.5;

/**
 * WCAG 1.4.11, for the parts of a control or a graphic needed to understand
 * it. The playing marker and the slider rails are judged against this.
 */
export const GRAPHIC_MINIMUM = 3;
