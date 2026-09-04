/**
 * The only file importing `d3-scale`.
 *
 * What is borrowed is the maths - tick selection and the domain-to-pixel
 * mapping - and nothing else: d3 draws no DOM here and holds no state. Every
 * element and every colour a chart puts on screen is this app's.
 *
 * The scales themselves are d3's objects, re-exported under names of ours.
 * Ticks are not: a chart needs them as data it can lay out and a test can
 * assert on, so [`ticks`] returns positioned labels rather than an axis
 * generator that would want a DOM node to write into.
 */

import { type ScaleLinear, scaleLinear } from "d3-scale";

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
