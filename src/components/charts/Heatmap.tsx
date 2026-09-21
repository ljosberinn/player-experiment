import type { CSSProperties } from "react";

import { ChartShell } from "./ChartShell";
import { rampStep } from "./scales";

/** How many of the columns the axis under the grid names. */
const AXIS_LABELS = 5;

export interface HeatmapProps {
  /** What the chart shows, for a reader who cannot see it. */
  readonly label: string;
  /** Top to bottom. Unique, since each is its row's identity. */
  readonly rows: readonly string[];
  /** Left to right. Unique, since each is its column's identity. */
  readonly columns: readonly string[];
  /** Row-major: the cell at `row`, `column` is `values[row * columns.length + column]`. */
  readonly values: readonly number[];
  /** How a value is written out, in the readout and the table. */
  readonly format: (value: number) => string;
  /** What the table's column of row names is called. */
  readonly corner: string;
  readonly empty: string;
  readonly loading?: boolean;
}

/**
 * A grid of cells over two categorical axes, each cell's colour its value.
 *
 * Section 4d. Thirteen-pixel cells over a 2px gap, a 22px column of day names
 * beside them and the axis under the lot - so an HTML grid rather than an svg,
 * since every one of those is a stated size and none of them is a share of
 * however much room the panel had. That is why this is the one chart to use
 * `ChartShell` directly: it wants the label, the empty and loading states and
 * the show-as-table toggle, and it wants none of the measuring, the margins or
 * the plot rect `ChartFrame` exists to hand down.
 *
 * Categorical on both sides for the reason `Bar` is on one: the caller owns
 * the order, and a weekday or an hour is a name rather than a position on a
 * scale.
 *
 * The colour is a step on the sheet's ramp rather than an opacity worked out
 * here, so every colour a cell can take is a token, and an empty cell stays
 * visibly empty beside the quietest one that is not.
 */
export function Heatmap({
  label,
  rows,
  columns,
  values,
  format,
  corner,
  empty,
  loading = false,
}: HeatmapProps) {
  const largest = Math.max(...values, 0);
  // The template is the one thing about the grid that is not a stated size,
  // and it is a count rather than a length: `library.css` still owns the
  // `minmax(0, 1fr)` that the count is repeated over.
  const template = { "--heatmap-columns": columns.length } as CSSProperties;

  // Drawn twice, and the same both times but for what is in the cells: the
  // grid is what holds the panel's height, so the thing standing in for it
  // while the aggregate is in flight has to be the grid. The days and the
  // hours are known before any of the counts are, so they are named rather
  // than greyed out with everything else.
  const grid = (pending: boolean) => (
    <div
      className={pending ? "heatmap heatmap-skeleton" : "heatmap"}
      {...(pending ? { "data-testid": "chart-skeleton" } : {})}
    >
      {rows.map((row, r) => (
        <div className="heatmap-row" key={row}>
          <span className="heatmap-day">{row}</span>
          <span className="heatmap-cells" style={template}>
            {columns.map((column, c) => {
              if (pending) {
                return <span key={column} className="heatmap-cell" />;
              }
              const value = values[r * columns.length + c] ?? 0;
              return (
                <span
                  key={column}
                  className="heatmap-cell"
                  data-step={rampStep(value, largest)}
                  // The pointer readout, which costs nothing and keeps the
                  // chart a pure function of its props. Presentational to a
                  // reader, like everything else under the shell's
                  // `role="img"` - the table is what that reader gets.
                  title={`${row} ${column}: ${format(value)}`}
                />
              );
            })}
          </span>
        </div>
      ))}
      <div className="heatmap-row heatmap-axis">
        <span />
        <span className="heatmap-ticks">
          {axisLabels(columns).map((name) => (
            <span key={name}>{name}</span>
          ))}
        </span>
      </div>
    </div>
  );

  const table = (
    <table className="chart-table">
      <thead>
        <tr>
          <th scope="col">{corner}</th>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={row}>
            <th scope="row">{row}</th>
            {columns.map((column, c) => (
              <td key={column}>{format(values[r * columns.length + c] ?? 0)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartShell
      label={label}
      {...(values.length === 0 && !loading ? { empty } : {})}
      loading={loading}
      table={table}
      skeleton={grid(true)}
      intrinsic
    >
      {grid(false)}
    </ChartShell>
  );
}

/**
 * The columns the axis under the grid names: the first, then every whole band
 * that fits, then the last.
 *
 * Over 24 hours that is the sheet's own `00 06 12 18 23`, and the labels are
 * spread with `space-between` rather than placed under their bands. The last
 * gap is therefore a little shorter than the others - which is the sheet's
 * compromise, and what keeps the last label from hanging off the end.
 */
function axisLabels(columns: readonly string[], count = AXIS_LABELS): string[] {
  if (columns.length <= count) {
    return [...columns];
  }
  const every = Math.floor(columns.length / (count - 1));
  return [
    ...Array.from({ length: count - 1 }, (_, index) => columns[index * every] ?? ""),
    columns[columns.length - 1] ?? "",
  ];
}
