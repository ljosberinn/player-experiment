/**
 * The only file importing d3.
 *
 * What is borrowed is the maths - tick selection, the domain-to-pixel mapping,
 * and the arithmetic of a ring segment - and nothing else: d3 draws no DOM
 * here and holds no state. Every element and every colour a chart puts on
 * screen is this app's.
 *
 * The scales themselves are d3's objects, re-exported under names of ours.
 * Ticks and arcs are not: a chart needs them as data it can lay out and a test
 * can assert on, so [`ticks`] returns positioned labels rather than an axis
 * generator that would want a DOM node to write into, and [`arcPath`] returns
 * the `d` attribute rather than the generator that makes it.
 */

import { type ScaleLinear, scaleLinear } from "d3-scale";
import { arc } from "d3-shape";

/** A continuous numeric scale: a value in the data, a position in pixels. */
export type LinearScale = ScaleLinear<number, number>;

/**
 * The extent of `values`, never collapsed onto a single point.
 *
 * Both degenerate cases are the panel's normal ones rather than exotica - a
 * filter that matched nothing, a series where every value is equal - and a
 * scale given either maps the whole domain onto one pixel, or onto NaN.
 */
export function niceDomain(values: readonly number[]): [number, number] {
  if (values.length === 0) {
    return [0, 1];
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? [min - 1, max + 1] : [min, max];
}

/**
 * A continuous scale over `domain`, in pixels over `range`.
 *
 * The d3 object itself rather than a wrapper: a chart calls it per datum, and
 * a function of ours forwarding to a function of d3's would be a layer that
 * only ever adds a stack frame.
 */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  return scaleLinear().domain(domain).range(range);
}

/** One labelled position on an axis. */
export interface Tick {
  readonly value: number;
  /** Where the tick sits, in the scale's range. */
  readonly offset: number;
  readonly label: string;
}

/**
 * About `count` ticks over `scale`, as data.
 *
 * `count` is a suggestion, which is d3's contract and not a wart: the point of
 * asking for five is to be given round numbers near five rather than five ugly
 * ones. A caller that needs an exact number is asking for the wrong thing.
 */
export function ticks(
  scale: LinearScale,
  count: number,
  format: (value: number) => string = String,
): Tick[] {
  return scale.ticks(count).map((value) => ({
    value,
    offset: scale(value),
    label: format(value),
  }));
}

/** How many non-empty steps the ramp has: `--chart-ramp-1` to `--chart-ramp-4`. */
export const RAMP_STEPS = 4;

/**
 * Which ramp step `value` takes: 0 for nothing, then 1 up to [`RAMP_STEPS`] by
 * its share of the largest.
 *
 * Rounded up, so any count at all is at least step 1 - a cell that was
 * listened in once and one that never was are the distinction a reader looks
 * for first.
 *
 * A quantize scale by another name, which is why it is here and not in the two
 * charts that draw one. What the step means is the ramp's contract, and two
 * copies of it is where a heatmap and a donut stop agreeing about how dark the
 * quietest thing on screen is.
 */
export function rampStep(value: number, largest: number): number {
  if (value <= 0 || largest <= 0) {
    return 0;
  }
  return Math.min(RAMP_STEPS, Math.ceil((value / largest) * RAMP_STEPS));
}

/**
 * One ring segment as an SVG `d`, centred on the origin, angles clockwise from
 * twelve o'clock.
 *
 * d3's generator rather than the trigonometry, for the case the trigonometry
 * gets wrong: **a slice of a whole turn is a full circle, and one `A` command
 * cannot draw one** - its start and end points coincide, so the renderer draws
 * nothing at all. d3 splits each edge of those into two half turns. One genre
 * holding every track is a state a small library is in from its first scan.
 *
 * An empty string for a slice of zero, which is what `<path d="">` renders as
 * nothing without the caller needing a branch. d3 gives that case a sliver -
 * out along the radius and straight back - which is a hairline on screen, and
 * a genre a filter has emptied should leave no mark rather than a thin one.
 */
export function arcPath(
  startAngle: number,
  endAngle: number,
  innerRadius: number,
  outerRadius: number,
): string {
  if (endAngle <= startAngle) {
    return "";
  }
  return arc()({ startAngle, endAngle, innerRadius, outerRadius }) ?? "";
}
