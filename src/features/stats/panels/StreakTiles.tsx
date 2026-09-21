import { StatTiles } from "../../../components/primitives/StatTiles";
import { statsStreaks } from "../../../ipc";
import { useListenQuery } from "../useListenQuery";
import { usePanelQuery } from "../usePanelQuery";
import { StatsPanel } from "./StatsPanel";

/**
 * Runs of consecutive days with a play.
 *
 * Two numbers, so two tiles: a chart of one datum each would be a chart of
 * nothing. A run that ended yesterday still counts as current, which the
 * backend decides - today is not over.
 */
export function StreakTiles() {
  const { query, deps } = useListenQuery();
  const { data } = usePanelQuery(() => statsStreaks(query), deps);

  return (
    <StatsPanel title="Streaks">
      <StatTiles
        tiles={[
          { label: "Current", value: days(data?.current) },
          {
            label: "Longest",
            value: days(data?.longest),
            ...(data?.longestFrom != null && data.longestTo != null
              ? { caption: `${localDate(data.longestFrom)} – ${localDate(data.longestTo)}` }
              : {}),
          },
        ]}
      />
    </StatsPanel>
  );
}

/** An em dash until the first answer lands, rather than a zero that is a lie. */
function days(value: number | undefined): string {
  if (value === undefined) {
    return "—";
  }
  return `${value.toLocaleString()} ${value === 1 ? "day" : "days"}`;
}

/**
 * A `YYYY-MM-DD` the backend cut in local time, shown in the local format.
 *
 * Parsed by hand: `new Date("2024-03-01")` is UTC midnight, which in a
 * negative offset is the day before, and the bound would read as a day off.
 */
function localDate(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (year === undefined || month === undefined || date === undefined) {
    return day;
  }
  return new Date(year, month - 1, date).toLocaleDateString();
}
