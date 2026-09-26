/**
 * The chart maths: tick selection, the domain-to-pixel mapping, and the
 * arithmetic of a ring segment.
 *
 * Ours rather than d3's since [167](../../../docs/issues/done/167-own-the-chart-maths.md):
 * the charts used one linear map, one tick rule and one arc shape, and those
 * pulled nine packages. The tick rule and the arc's output follow d3's, so an
 * axis and a donut draw what they drew before.
 *
 * Ticks and arcs come out as data a chart can lay out and a test can assert
 * on: [`ticks`] returns positioned labels rather than an axis generator that
 * would want a DOM node to write into, and [`arcPath`] returns the `d`
 * attribute rather than a generator that makes it.
 */

const TAU = Math.PI * 2;

/** d3-path's tolerance for an arc that is nothing or a whole turn. */
const EPSILON = 1e-6;

/** A continuous numeric scale: a value in the data, a position in pixels. */
export interface LinearScale {
  (value: number): number;
  readonly domain: readonly [number, number];
}

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
 * Interpolated as `r0 * (1 - t) + r1 * t` rather than `r0 + t * (r1 - r0)`,
 * which is exact at both ends: a full-height bar lands on the axis rather than
 * a rounding error off it.
 */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const scale = (value: number) => {
    const t = (value - d0) / (d1 - d0);
    return r0 * (1 - t) + r1 * t;
  };
  return Object.assign(scale, { domain });
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
  return tickValues(...scale.domain, count).map((value) => ({
    value,
    offset: scale(value),
    label: format(value),
  }));
}

/**
 * d3's tick rule: a step of 1, 2, 5 or 10 times a power of ten, whichever is
 * nearest `(stop - start) / count` on a log scale, and every multiple of it
 * inside the domain. Ascending domains only, which is all `niceDomain` and
 * `Bar` produce; anything else yields no ticks.
 */
function tickValues(start: number, stop: number, count: number): number[] {
  const step = (stop - start) / count;
  const power = Math.floor(Math.log10(step));
  const error = step / 10 ** power;
  const factor =
    error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.sqrt(2) ? 2 : 1;
  // A step below one is held as its reciprocal and divided by, so the third
  // tick of 0.1 is 3 / 10 rather than 3 * 0.1, which is 0.30000000000000004.
  const inverse = power < 0;
  const unit = inverse ? 10 ** -power / factor : 10 ** power * factor;
  const at = (index: number) => (inverse ? index / unit : index * unit);
  // Rounded, then nudged inward, rather than a ceil and a floor: `start /
  // unit` a hair above a whole number would otherwise skip the tick on it.
  let first = Math.round(inverse ? start * unit : start / unit);
  let last = Math.round(inverse ? stop * unit : stop / unit);
  if (at(first) < start) {
    first += 1;
  }
  if (at(last) > stop) {
    last -= 1;
  }
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => at(first + index));
}

/** How many non-empty steps the ramp has: `--chart-ramp-1` to `--chart-ramp-7`. */
export const RAMP_STEPS = 7;

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
 * **A slice of a whole turn is a full circle, and one `A` command cannot draw
 * one** - its start and end points coincide, so the renderer draws nothing at
 * all. Each edge of those is two half turns instead, the hole wound against
 * the rim so the nonzero fill rule leaves it empty. One genre holding every
 * track is a state a small library is in from its first scan.
 *
 * An empty string for a slice of zero, which is what `<path d="">` renders as
 * nothing without the caller needing a branch. d3 gives that case a sliver -
 * out along the radius and straight back - which is a hairline on screen, and
 * a genre a filter has emptied should leave no mark rather than a thin one.
 *
 * Coordinates are rounded to three places, as d3's were: `cos` of a quarter
 * turn is 6e-17, not 0, and a path is no place for that.
 */
export function arcPath(
  startAngle: number,
  endAngle: number,
  innerRadius: number,
  outerRadius: number,
): string {
  const sweep = endAngle - startAngle;
  if (!(sweep > EPSILON)) {
    return "";
  }
  // SVG measures clockwise from three o'clock; a chart, from twelve.
  const a0 = startAngle - Math.PI / 2;
  const a1 = endAngle - Math.PI / 2;
  const outer = `${round(outerRadius)},${round(outerRadius)},0`;
  const inner = `${round(innerRadius)},${round(innerRadius)},0`;

  if (sweep > TAU - EPSILON) {
    const rim = polar(outerRadius, a0);
    const hole = polar(innerRadius, a1);
    return (
      `M${rim.at}A${outer},1,1,${rim.opposite}A${outer},1,1,${rim.at}` +
      `M${hole.at}A${inner},1,0,${hole.opposite}A${inner},1,0,${hole.at}Z`
    );
  }

  const large = sweep >= Math.PI ? 1 : 0;
  return (
    `M${polar(outerRadius, a0).at}A${outer},${large},1,${polar(outerRadius, a1).at}` +
    `L${polar(innerRadius, a1).at}A${inner},${large},0,${polar(innerRadius, a0).at}Z`
  );
}

/** A point on a circle round the origin, and the one across from it, as `x,y`. */
function polar(radius: number, angle: number): { at: string; opposite: string } {
  const x = radius * Math.cos(angle);
  const y = radius * Math.sin(angle);
  return { at: `${round(x)},${round(y)}`, opposite: `${round(-x)},${round(-y)}` };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
