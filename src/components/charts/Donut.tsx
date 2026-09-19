import { ChartFrame, RADIAL_MARGIN } from "./ChartFrame";
import { arcPath, rampStep } from "./scales";

/** How much of the radius the hole takes. */
const HOLE = 0.58;

export interface DonutSlice {
  /** Identity, which a label need not be - two genres can print the same. */
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /**
   * What clicking the slice does, where there is anything below it.
   *
   * Absent means inert rather than disabled: a slice that opened onto its own
   * count and nothing else is a step the reader cannot tell is a dead end
   * before taking it.
   */
  readonly onSelect?: () => void;
  /** A qualifier for the table, where the label alone would overstate it. */
  readonly note?: string;
}

export interface DonutProps {
  /** What the chart shows, for a reader who cannot see it. */
  readonly label: string;
  /** Drawn clockwise from twelve in the order given - the caller owns it. */
  readonly slices: readonly DonutSlice[];
  readonly format: (value: number) => string;
  /** What the table's column of slice names is called. */
  readonly column: string;
  readonly empty: string;
  readonly loading?: boolean;
}

/**
 * A ring of slices, each sized by its share of their total.
 *
 * Of their total rather than of a scale's domain, which is the one thing a
 * donut does that no other chart here does: the whole is the sum, so a slice
 * means the same on every panel that draws one without agreeing on a maximum.
 *
 * The tone is the sequential ramp rather than a colour per slice. There is no
 * categorical palette in the sheet, and there does not need to be: a caller
 * orders slices by size, so the ramp lands darkest on the smallest and reads
 * as the magnitude it already is. A hairline between neighbours is what keeps
 * two slices of one step apart.
 *
 * **The table is how a reader reaches the labels and the drill.** `ChartFrame`
 * makes the svg `role="img"`, so nothing inside it is reachable by anything
 * but a pointer - the same bargain `Heatmap` strikes, and the reason every
 * chart here ships a table rather than treating one as a nicety.
 */
export function Donut({ label, slices, format, column, empty, loading = false }: DonutProps) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const largest = Math.max(...slices.map((slice) => slice.value), 0);

  const table = (
    <table className="chart-table">
      <thead>
        <tr>
          <th scope="col">{column}</th>
          <th scope="col">Tracks</th>
        </tr>
      </thead>
      <tbody>
        {slices.map((slice) => (
          <tr key={slice.key}>
            <th scope="row">
              {slice.onSelect === undefined ? (
                slice.label
              ) : (
                <button type="button" className="chart-table-drill" onClick={slice.onSelect}>
                  {slice.label}
                </button>
              )}
              {slice.note !== undefined && <span className="chart-note">{slice.note}</span>}
            </th>
            <td>{format(slice.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartFrame
      label={label}
      {...(slices.length === 0 && !loading ? { empty } : {})}
      loading={loading}
      table={table}
      grid={false}
      margin={RADIAL_MARGIN}
    >
      {(plot) => {
        // Square, so the ring is a ring in a panel of any proportion, and
        // centred in whichever direction has the slack.
        const outer = Math.min(plot.width, plot.height) / 2;
        let start = 0;

        return (
          <g transform={`translate(${plot.width / 2}, ${plot.height / 2})`}>
            {slices.map((slice) => {
              // Off the running total rather than a cumulative sum per slice,
              // so the last slice ends exactly on the turn instead of a
              // rounding error short of it.
              const end = total === 0 ? start : start + (slice.value / total) * Math.PI * 2;
              const path = arcPath(start, end, outer * HOLE, outer);
              start = end;

              return (
                // A pointer shortcut for the table's button, not an affordance
                // of its own. `role="button"` here would claim one that no
                // assistive technology can reach: the frame's `role="img"`
                // makes this whole subtree presentational, which is why the
                // table carries the real control.
                // biome-ignore lint/a11y/noStaticElementInteractions: the drill has a button in the table
                <path
                  key={slice.key}
                  className="chart-slice"
                  data-step={rampStep(slice.value, largest)}
                  {...(slice.onSelect === undefined ? {} : { "data-drills": "" })}
                  d={path}
                  onClick={slice.onSelect}
                >
                  <title>{`${slice.label}: ${format(slice.value)}`}</title>
                </path>
              );
            })}
          </g>
        );
      }}
    </ChartFrame>
  );
}
