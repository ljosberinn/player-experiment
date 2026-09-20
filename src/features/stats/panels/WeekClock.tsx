import { Bar } from "../../../components/charts/Bar";
import { Heatmap } from "../../../components/charts/Heatmap";
import { statsWeekClock } from "../../../ipc";
import { listenTotalsOnce } from "../listenTotals";
import { useListenQuery } from "../useListenQuery";
import { usePanelQuery } from "../usePanelQuery";
import { StatsPanel } from "./StatsPanel";

/** Monday first, as `week_clock` counts. 2024-01-01 was a Monday. */
const WEEKDAYS = Array.from({ length: 7 }, (_, day) =>
  new Date(2024, 0, 1 + day).toLocaleDateString(undefined, { weekday: "short" }),
);

const HOURS = Array.from({ length: 24 }, (_, hour) =>
  new Date(2024, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" }),
);

/**
 * When in the week the plays fall, and when in the day.
 *
 * **One panel because it is one query.** Hour-of-day is the week clock's
 * column sums, so two panels would scan the log twice for one answer. The
 * bars are kept under the grid they duplicate because length reads better
 * than colour: the busiest hour is found faster off 24 bars than off 168
 * cells.
 */
export function WeekClock() {
  const { query, deps } = useListenQuery();
  const { data, loading } = usePanelQuery(
    () => Promise.all([statsWeekClock(query), listenTotalsOnce(query)]),
    deps,
  );

  // The clock is always 168 counts, so nothing played is all zeroes rather
  // than no rows; the charts are told it is empty.
  const clock = data?.[0].some((count) => count > 0) ? data[0] : [];
  const totals = data?.[1];
  const format = (count: number) => count.toLocaleString();

  return (
    <StatsPanel
      title="When you listen"
      caption={
        totals !== undefined && totals.dated < totals.plays
          ? // Down, for `SeriesPanel`'s reason.
            `Date known for ${Math.floor((totals.dated / totals.plays) * 100)}% of plays.`
          : null
      }
    >
      <Heatmap
        label="Plays by weekday and hour"
        rows={WEEKDAYS}
        columns={HOURS}
        values={clock}
        format={format}
        corner="Day"
        empty="Nothing in this range."
        loading={loading}
      />
      {/* Once is enough to say the range is empty. */}
      {(loading || clock.length > 0) && (
        <Bar
          label="Plays by hour of day"
          data={
            clock.length === 0
              ? []
              : HOURS.map((hour, index) => ({
                  label: hour,
                  value: WEEKDAYS.reduce((sum, _, day) => sum + (clock[day * 24 + index] ?? 0), 0),
                }))
          }
          format={format}
          columns={["Hour", "Plays"]}
          empty="Nothing in this range."
          loading={loading}
        />
      )}
    </StatsPanel>
  );
}
