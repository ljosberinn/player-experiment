import { Streak } from "../../../components/primitives/Streak";
import { statsStreaks } from "../../../ipc";
import { useListenQuery } from "../useListenQuery";
import { usePanelQuery } from "../usePanelQuery";
import { StatsPanel } from "./StatsPanel";

/**
 * Runs of consecutive days with a play.
 *
 * A run that ended yesterday still counts as current, which the backend
 * decides - today is not over. The seven days come off the same walk, so the
 * strip is under the same filters as the figures above it.
 */
export function StreakPanel() {
  const { query, deps } = useListenQuery();
  const { data } = usePanelQuery(() => statsStreaks(query), deps);

  return (
    <StatsPanel title="Streaks">
      <Streak
        current={data?.current}
        longest={data?.longest}
        {...(data?.longestFrom != null && data.longestTo != null
          ? { span: `${localDate(data.longestFrom)} – ${localDate(data.longestTo)}` }
          : {})}
        days={data?.lastSeven ?? []}
        format={days}
      />
    </StatsPanel>
  );
}

function days(value: number): string {
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
