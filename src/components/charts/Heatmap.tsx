import { type AxisTick, ChartFrame, type PlotRect } from "./ChartFrame";

/** How many non-empty steps the ramp has: `--chart-ramp-1` to `--chart-ramp-4`. */
const HEATMAP_STEPS = 4;

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
 * Categorical on both sides for the reason `Bar` is on one: the caller owns
 * the order, and a weekday or an hour is a name rather than a position on a
 * scale. So the frame draws no gridlines - a line through a row's middle
 * shows through every gap between its cells and measures nothing.
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
    <ChartFrame
      label={label}
      {...(values.length === 0 && !loading ? { empty } : {})}
      loading={loading}
      table={table}
      grid={false}
      xTicks={(plot) => thin(columns, plot.width, 40)}
      yTicks={(plot) => thin(rows, plot.height, 14)}
    >
      {(plot) => {
        const { width, height } = cellSize(plot, rows.length, columns.length);

        return rows.flatMap((row, r) =>
          columns.map((column, c) => {
            const value = values[r * columns.length + c] ?? 0;
            return (
              <rect
                key={`${row}|${column}`}
                className="chart-cell"
                data-step={step(value, largest)}
                x={c * (plot.width / columns.length)}
                y={r * (plot.height / rows.length)}
                width={width}
                height={height}
                rx={2}
              >
                <title>{`${row} ${column}: ${format(value)}`}</title>
              </rect>
            );
          }),
        );
      }}
    </ChartFrame>
  );
}

/**
 * Which ramp step `value` takes: 0 for nothing, then 1 up to `HEATMAP_STEPS`
 * by its share of the largest.
 *
 * Rounded up, so any count at all is at least step 1 - a cell that was
 * listened in once and one that never was are the distinction a reader looks
 * for first.
 */
function step(value: number, largest: number): number {
  if (value <= 0 || largest <= 0) {
    return 0;
  }
  return Math.min(HEATMAP_STEPS, Math.ceil((value / largest) * HEATMAP_STEPS));
}

/**
 * A cell's drawn size: its band, less a gap that goes once the band is too
 * small to spare it.
 */
function cellSize(plot: PlotRect, rows: number, columns: number) {
  const across = plot.width / Math.max(1, columns);
  const down = plot.height / Math.max(1, rows);
  const gap = (band: number) => (band > 8 ? 2 : 0);
  return {
    width: Math.max(0, across - gap(across)),
    height: Math.max(0, down - gap(down)),
  };
}

/**
 * A label at the middle of every band it fits over, starting with the first.
 *
 * `room` is what one label needs along the axis, so twenty-four hours across
 * a narrow panel label every third rather than overlapping.
 */
function thin(names: readonly string[], length: number, room: number): AxisTick[] {
  if (names.length === 0 || length === 0) {
    return [];
  }
  const band = length / names.length;
  const every = Math.max(1, Math.ceil(room / band));
  return names.flatMap((name, index) =>
    index % every === 0 ? [{ offset: index * band + band / 2, label: name }] : [],
  );
}
