import { type ReactNode, useState } from "react";

export interface ChartShellProps {
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
  /**
   * What holds the space while the aggregate is in flight.
   *
   * The block the shell draws by default fills the fixed height a `.chart`
   * has; an intrinsic chart has no fixed height to fill, so it hands in
   * something of its own or the panel collapses and springs back open.
   */
  readonly skeleton?: ReactNode;
  /**
   * Whether the box takes its height from its contents rather than from the
   * sheet's fixed one. For a drawing that is a grid of stated sizes rather
   * than a plot scaled to whatever room it was given.
   */
  readonly intrinsic?: boolean;
  /** The box to measure, for a chart drawn from its own size. */
  readonly plotRef?: (element: HTMLElement | null) => void;
  readonly children: ReactNode;
}

/**
 * Everything around a chart that is not the drawing: the accessible name, the
 * empty and loading states, and the show-as-table toggle.
 *
 * Split out of {@link ChartFrame} in 116b, when the heatmap became an HTML
 * grid of stated sizes. The alternative was a second toggle mechanism in the
 * app, and the toggle and the `role="img"` label live in one place precisely
 * so that no panel can ship without them.
 *
 * The label goes on the measured box rather than on the svg inside it, so that
 * a drawing made of `<div>`s gets it on the same terms an svg does - and it
 * goes on only while the drawing is up, since the table, the empty message and
 * the skeleton are all text a reader should reach rather than a picture.
 */
export function ChartShell({
  label,
  empty,
  loading = false,
  table,
  skeleton,
  intrinsic = false,
  plotRef,
  children,
}: ChartShellProps) {
  const [showTable, setShowTable] = useState(false);
  const section = (state?: string) =>
    ["chart", intrinsic ? "chart-intrinsic" : "", state ?? ""].filter(Boolean).join(" ");
  // Named as a picture only while the picture is up. The table under the same
  // toggle is text a reader should walk, and a `role="img"` over it would take
  // every cell away again.
  const named = showTable ? {} : ({ role: "img", "aria-label": label } as const);

  // Loading outranks empty: an aggregate that has not landed is not an
  // aggregate of nothing, and saying there are no plays and correcting it a
  // frame later is worse than saying nothing yet. The table's skeleton rows
  // make the same argument.
  if (loading) {
    return (
      <section className={section("chart-loading")}>
        <div className="chart-plot" ref={plotRef}>
          {skeleton ?? <div className="chart-skeleton" data-testid="chart-skeleton" />}
        </div>
      </section>
    );
  }

  // Still measured while empty, so the chart that arrives when the filter
  // widens is drawn at the right size on its first frame rather than at zero
  // and then again.
  if (empty !== undefined) {
    return (
      <section className={section("chart-empty")}>
        <div className="chart-plot" ref={plotRef}>
          <p>{empty}</p>
        </div>
      </section>
    );
  }

  return (
    <section className={section()}>
      {/* The measured box is this, not the section, and the toggle is outside
          it. Measuring a box that contains the button would make the svg as
          tall as the section, the section as tall as the svg plus the button,
          and every frame a little taller than the last. */}
      {/* Scrollable only while the table is up. With the svg in it, the svg
          is exactly the box's client size, so a scrollbar would narrow the
          box, which would narrow the svg, which would take the scrollbar
          away again - a measurement that never settles. */}
      <div
        className={showTable ? "chart-plot chart-plot-table" : "chart-plot"}
        ref={plotRef}
        {...named}
      >
        {/* Nothing inside carries an `aria-hidden`: `role="img"` already makes
            the whole subtree presentational, and the label plus the table
            toggle are what a reader gets instead. */}
        {showTable ? table : children}
      </div>
      {table !== undefined && (
        <button
          type="button"
          className="chart-toggle"
          onClick={() => setShowTable((shown) => !shown)}
        >
          {showTable ? "Show as chart" : "Show as table"}
        </button>
      )}
    </section>
  );
}
