import { type AxisTick, ChartFrame, type PlotRect } from "./ChartFrame";
import { linearScale, ticks } from "./scales";

/** One bar: what it counts, and what the axis calls it. */
export interface BarDatum {
  /** Identity, and the x-axis label. Unique within a chart. */
  readonly label: string;
  readonly value: number;
}

export interface BarProps {
  /** What the chart shows, for a reader who cannot see it. */
  readonly label: string;
  /** Left to right in the order given; a band per entry, nothing in between. */
  readonly data: readonly BarDatum[];
  /** How a value is written out, on the axis and in the readout. */
  readonly format: (value: number) => string;
  /** What the two table columns are called. */
  readonly columns: readonly [string, string];
  readonly empty: string;
  readonly loading?: boolean;
}

/**
 * A column of bars over a categorical axis.
 *
 * Every histogram and every time series in the view is this: the bins differ,
 * the drawing does not. The domain is the array's order rather than a numeric
 * scale, because a sparse series and a histogram with an empty bin both want
 * the gap to be one the caller left, not one the chart inferred.
 *
 * A pure function of its props, as [70](../../../docs/issues/done/70-chart-primitives.md)
 * requires: the per-bar readout is a `<title>`, which the browser shows on
 * hover for nothing, rather than a hover state and a positioned box.
 *
 * The table reading is built here rather than taken as a prop. A bar chart's
 * table is always the same two columns, and a panel that had to supply one
 * could supply a wrong one.
 */
export function Bar({ label, data, format, columns, empty, loading = false }: BarProps) {
  // Never zero: a chart of nothing but zeroes would divide every bar by it.
  const largest = Math.max(...data.map((datum) => datum.value), 1);
  const scaleFor = (plot: PlotRect) => linearScale([0, largest], [plot.height, 0]);

  const table = (
    <table className="chart-table">
      <thead>
        <tr>
          <th scope="col">{columns[0]}</th>
          <th scope="col">{columns[1]}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((datum) => (
          <tr key={datum.label}>
            <th scope="row">{datum.label}</th>
            <td>{format(datum.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartFrame
      label={label}
      // Spread rather than passed as `undefined`: `exactOptionalPropertyTypes`
      // treats an absent prop and one set to undefined as different things,
      // and the frame's contract is that `empty` present means empty.
      {...(data.length === 0 && !loading ? { empty } : {})}
      loading={loading}
      table={table}
      xTicks={(plot) => xAxis(data, plot)}
      yTicks={(plot) => ticks(scaleFor(plot), 4, format)}
    >
      {(plot) => {
        const y = scaleFor(plot);
        const band = plot.width / data.length;
        // One pixel of air between bars, and none once a band is too narrow
        // to spare it: 55 years across a panel is a bar three pixels wide,
        // and a gap there would take a third of the ink.
        const width = Math.max(1, band - (band > 4 ? 1 : 0));

        return data.map((datum, index) => (
          <rect
            key={datum.label}
            className="chart-bar"
            x={index * band}
            y={y(datum.value)}
            width={width}
            height={Math.max(0, plot.height - y(datum.value))}
          >
            <title>{`${datum.label}: ${format(datum.value)}`}</title>
          </rect>
        ));
      }}
    </ChartFrame>
  );
}

/**
 * As many x labels as fit, evenly spaced, each centred on its band.
 *
 * Thinned rather than rotated or truncated: a year every tenth bar reads as a
 * scale, and 55 labels overlapping read as a smudge. The first band is always
 * labelled, so the axis starts where the data does.
 */
function xAxis(data: readonly BarDatum[], plot: PlotRect): AxisTick[] {
  if (data.length === 0 || plot.width === 0) {
    return [];
  }
  const band = plot.width / data.length;
  /** Room for one label and the space either side of it. */
  const room = 48;
  const every = Math.max(1, Math.ceil(room / band));

  return data.flatMap((datum, index) =>
    index % every === 0 ? [{ offset: index * band + band / 2, label: datum.label }] : [],
  );
}
