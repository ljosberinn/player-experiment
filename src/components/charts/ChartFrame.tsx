import { type ReactNode, useCallback, useState } from "react";

import { ChartShell } from "./ChartShell";

/**
 * Room for the axis labels around the plot.
 *
 * One constant rather than a prop: every chart in the view shares an axis
 * gutter, and charts whose plots start at different x do not read as a set.
 */
export interface ChartMargin {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const CHART_MARGIN: ChartMargin = { top: 8, right: 8, bottom: 20, left: 40 };

/**
 * The margin a chart with no axis takes instead.
 *
 * Not a violation of the rule above but the other side of it: what the one
 * constant buys is charts whose *plots* line up, and a radial chart has no
 * plot to line up - an axis gutter under a donut is a ring drawn off-centre
 * in its own panel.
 */
export const RADIAL_MARGIN: ChartMargin = { top: 8, right: 8, bottom: 8, left: 8 };

/** The plot rect, in pixels, once the margins are taken off the measurement. */
export interface PlotRect {
  readonly width: number;
  readonly height: number;
}

/**
 * One labelled position on an axis.
 *
 * Narrower than `scales.ts`'s `Tick` on purpose: the frame draws what it is
 * given and never asks what the value behind a label was, so a category axis
 * whose values are strings satisfies this too.
 */
export interface AxisTick {
  readonly offset: number;
  readonly label: string;
}

/**
 * Axis ticks, or how to work them out once the plot has been measured.
 *
 * A scale's range is the measured plot, so every tick position on it depends
 * on a number only this component has. The first chart to draw one - `Bar` -
 * is what found that out; the plain array stays for an axis whose positions
 * are fixed.
 */
export type Ticks = readonly AxisTick[] | ((plot: PlotRect) => readonly AxisTick[]);

export interface ChartFrameProps {
  /** What the chart shows, for a reader who cannot see it. */
  readonly label: string;
  /** Why there is nothing to draw. Drawn in place of the chart when set. */
  readonly empty?: string;
  /** Whether the aggregate behind the chart is still in flight. */
  readonly loading?: boolean;
  /**
   * The same numbers as a table, shown in place of the chart on request.
   *
   * A panel supplies the markup because only it knows what its columns are
   * called; what the shell owns is the toggle, so that a panel cannot ship
   * without one.
   */
  readonly table?: ReactNode;
  readonly xTicks?: Ticks;
  readonly yTicks?: Ticks;
  /**
   * Whether a line runs across the plot at each y tick. Off for an axis of
   * categories, where a tick names a row rather than a value to read across.
   */
  readonly grid?: boolean;
  /** [`RADIAL_MARGIN`] for a chart with no axis; the default otherwise. */
  readonly margin?: ChartMargin;
  readonly children: (plot: PlotRect) => ReactNode;
}

/**
 * The box an svg chart is drawn in: it measures, and hands down a plot rect.
 *
 * A chart primitive is then a pure function of its data and that rect, with no
 * measurement, no `ResizeObserver` and no opinion about margins of its own.
 *
 * Everything that is not the svg - the label, the empty and loading states,
 * the show-as-table toggle - is {@link ChartShell}, which a chart that draws
 * no svg uses on its own.
 */
export function ChartFrame({
  label,
  empty,
  loading = false,
  table,
  xTicks: xSource = [],
  yTicks: ySource = [],
  grid = true,
  margin = CHART_MARGIN,
  children,
}: ChartFrameProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  // The `<section>`'s plot box is measured, not a scroll container around it,
  // and into state rather than out of a ref during render - `BrowseView`'s
  // rule, for the reason it paid for. A callback ref rather than an effect
  // because the element is not in the DOM on mount of an empty view.
  const attach = useCallback((element: HTMLElement | null) => {
    if (element === null) {
      return;
    }
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plot: PlotRect = {
    width: Math.max(0, size.width - margin.left - margin.right),
    height: Math.max(0, size.height - margin.top - margin.bottom),
  };
  const xTicks = typeof xSource === "function" ? xSource(plot) : xSource;
  const yTicks = typeof ySource === "function" ? ySource(plot) : ySource;

  return (
    <ChartShell
      label={label}
      {...(empty === undefined ? {} : { empty })}
      loading={loading}
      {...(table === undefined ? {} : { table })}
      plotRef={attach}
    >
      {/* Presentational, because the shell's box around it is what carries
          `role="img"` and the label since 116b - a grid of `<div>`s needed the
          same bargain an svg gets, so it was made once on the box both sit in.
          A second `role="img"` here would be a picture inside a picture. */}
      <svg role="presentation" width={size.width} height={size.height}>
        <g transform={`translate(${margin.left}, ${margin.top})`}>
          {grid && (
            <g className="chart-grid">
              {yTicks.map((tick) => (
                <line key={tick.label} x1={0} x2={plot.width} y1={tick.offset} y2={tick.offset} />
              ))}
            </g>
          )}
          <g className="chart-axis chart-axis-x">
            {xTicks.map((tick) => (
              <text key={tick.label} x={tick.offset} y={plot.height + margin.bottom - 6}>
                {tick.label}
              </text>
            ))}
          </g>
          <g className="chart-axis chart-axis-y">
            {yTicks.map((tick) => (
              <text key={tick.label} x={-6} y={tick.offset}>
                {tick.label}
              </text>
            ))}
          </g>
          {children(plot)}
        </g>
      </svg>
    </ChartShell>
  );
}
