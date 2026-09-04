import { type ReactNode, useCallback, useState } from "react";

/**
 * Room for the axis labels around the plot.
 *
 * One constant rather than a prop: every chart in the view shares an axis
 * gutter, and charts whose plots start at different x do not read as a set.
 */
export const CHART_MARGIN = { top: 8, right: 8, bottom: 20, left: 40 } as const;

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
   * called; what the frame owns is the toggle, so that a panel cannot ship
   * without one.
   */
  readonly table?: ReactNode;
  readonly xTicks?: readonly AxisTick[];
  readonly yTicks?: readonly AxisTick[];
  readonly children: (plot: PlotRect) => ReactNode;
}

/**
 * The box every chart is drawn in: it measures, and hands down a plot rect.
 *
 * A chart primitive is then a pure function of its data and that rect, with no
 * measurement, no `ResizeObserver` and no opinion about margins of its own.
 */
export function ChartFrame({
  label,
  empty,
  loading = false,
  table,
  xTicks = [],
  yTicks = [],
  children,
}: ChartFrameProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [showTable, setShowTable] = useState(false);

  // The `<section>` is measured, not a scroll container around it, and into
  // state rather than out of a ref during render - `BrowseView`'s rule, for
  // the reason it paid for. A callback ref rather than an effect because the
  // element is not in the DOM on mount of an empty view.
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
    width: Math.max(0, size.width - CHART_MARGIN.left - CHART_MARGIN.right),
    height: Math.max(0, size.height - CHART_MARGIN.top - CHART_MARGIN.bottom),
  };

  // Loading outranks empty: an aggregate that has not landed is not an
  // aggregate of nothing, and saying there are no plays and correcting it a
  // frame later is worse than saying nothing yet. The table's skeleton rows
  // make the same argument.
  if (loading) {
    return (
      <section className="chart chart-loading" ref={attach}>
        <div className="chart-skeleton" data-testid="chart-skeleton" />
      </section>
    );
  }

  // The section is still measured while empty, so the chart that arrives when
  // the filter widens is drawn at the right size on its first frame rather
  // than at zero and then again.
  if (empty !== undefined) {
    return (
      <section className="chart chart-empty" ref={attach}>
        <p>{empty}</p>
      </section>
    );
  }

  return (
    <section className="chart" ref={attach}>
      {showTable ? (
        table
      ) : (
        <svg role="img" aria-label={label} width={size.width} height={size.height}>
          <g transform={`translate(${CHART_MARGIN.left}, ${CHART_MARGIN.top})`}>
            {/* Nothing inside carries an `aria-hidden`: `role="img"` already
                makes the whole subtree presentational, and the label plus the
                table toggle are what a reader gets instead. */}
            <g className="chart-grid">
              {yTicks.map((tick) => (
                <line key={tick.label} x1={0} x2={plot.width} y1={tick.offset} y2={tick.offset} />
              ))}
            </g>
            <g className="chart-axis chart-axis-x">
              {xTicks.map((tick) => (
                <text key={tick.label} x={tick.offset} y={plot.height + CHART_MARGIN.bottom - 6}>
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
      )}
      {table !== undefined && (
        <button type="button" onClick={() => setShowTable((shown) => !shown)}>
          {showTable ? "Show as chart" : "Show as table"}
        </button>
      )}
    </section>
  );
}
