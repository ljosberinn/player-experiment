import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatsPanel } from "../../features/stats/panels/StatsPanel";
import { Heatmap } from "./Heatmap";

/** `WeekClock`'s axes: Monday first, 2024-01-01 being one. */
const WEEKDAYS = Array.from({ length: 7 }, (_, day) =>
  new Date(2024, 0, 1 + day).toLocaleDateString(undefined, { weekday: "short" }),
);

const HOURS = Array.from({ length: 24 }, (_, hour) =>
  new Date(2024, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" }),
);

/** Evenings and weekend afternoons, and nothing at all before dawn. */
const FULL = WEEKDAYS.flatMap((_, day) =>
  HOURS.map((_, hour) => {
    if (hour < 6) {
      return 0;
    }
    const evening = Math.max(0, 1 - Math.abs(hour - 21) / 6);
    const afternoon = day >= 5 ? Math.max(0, 1 - Math.abs(hour - 15) / 5) : 0;
    return Math.round(40 * evening + 30 * afternoon + ((day + hour) % 4) * 2);
  }),
);

/** A handful of plays, so most cells are the empty step beside the quietest filled one. */
const SPARSE = FULL.map((_, index) =>
  [45, 46, 93, 140, 141, 142].includes(index) ? (index % 3) + 1 : 0,
);

const ZERO = FULL.map(() => 0);

const plays = (value: number) => value.toLocaleString();

/** Every state `Heatmap` draws, each in the panel box the app puts it in. */
function States() {
  return (
    <div
      style={{
        padding: 24,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(460px, 1fr))",
        gap: 20,
      }}
    >
      <StatsPanel title="A full week">
        <Heatmap
          label="Plays by weekday and hour"
          rows={WEEKDAYS}
          columns={HOURS}
          values={FULL}
          format={plays}
          corner="Day"
          empty="Nothing in this range."
        />
      </StatsPanel>
      <StatsPanel title="Sparse">
        <Heatmap
          label="Plays by weekday and hour"
          rows={WEEKDAYS}
          columns={HOURS}
          values={SPARSE}
          format={plays}
          corner="Day"
          empty="Nothing in this range."
        />
      </StatsPanel>
      {/* What the grid draws if handed the 168 zeroes `week_clock` answers
          with for nothing played. `WeekClock` passes `[]` instead, which is
          the empty state beside it. */}
      <StatsPanel title="All zero">
        <Heatmap
          label="Plays by weekday and hour"
          rows={WEEKDAYS}
          columns={HOURS}
          values={ZERO}
          format={plays}
          corner="Day"
          empty="Nothing in this range."
        />
      </StatsPanel>
      <StatsPanel title="Empty">
        <Heatmap
          label="Plays by weekday and hour"
          rows={WEEKDAYS}
          columns={HOURS}
          values={[]}
          format={plays}
          corner="Day"
          empty="Nothing in this range."
        />
      </StatsPanel>
      <StatsPanel title="Loading">
        <Heatmap
          label="Plays by weekday and hour"
          rows={WEEKDAYS}
          columns={HOURS}
          values={[]}
          format={plays}
          corner="Day"
          empty="Nothing in this range."
          loading
        />
      </StatsPanel>
    </div>
  );
}

const meta = {
  title: "Charts/Heatmap",
  component: States,
} satisfies Meta<typeof States>;

export default meta;

export const State: StoryObj<typeof meta> = {};
