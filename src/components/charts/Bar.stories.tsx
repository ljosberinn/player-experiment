import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatsPanel } from "../../features/stats/panels/StatsPanel";
import { Bar } from "./Bar";

/** Fifty-five years, the first ten of them sparse, so the axis has to thin its labels. */
const YEARS = Array.from({ length: 55 }, (_, index) => ({
  label: String(1970 + index),
  value: Math.max(
    0,
    Math.round(30 + 26 * Math.sin(index / 6) + (index % 5) * 7 - (index < 10 ? 34 : 0)),
  ),
}));

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  label: String(hour).padStart(2, "0"),
  value: Math.round(60 + 55 * Math.sin(((hour - 13) / 24) * Math.PI * 2) + (hour % 3) * 9),
}));

const count = (value: number) => value.toLocaleString();

/** Every state `Bar` draws, each in the panel box the app puts it in. */
function States() {
  return (
    <div
      style={{
        padding: 24,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
        gap: 20,
      }}
    >
      <StatsPanel title="Release years">
        <Bar
          label="Songs per release year"
          data={YEARS}
          format={count}
          columns={["Year", "Songs"]}
          empty="Nothing here has a year."
        />
      </StatsPanel>
      <StatsPanel title="Hour of day">
        <Bar
          label="Plays by hour of day"
          data={HOURS}
          format={count}
          columns={["Hour", "Plays"]}
          empty="Nothing in this range."
        />
      </StatsPanel>
      <StatsPanel title="Three bars">
        <Bar
          label="Plays per month"
          data={[
            { label: "Jul", value: 412 },
            { label: "Aug", value: 0 },
            { label: "Sep", value: 1280 },
          ]}
          format={count}
          columns={["Month", "Plays"]}
          empty="Nothing in this range."
        />
      </StatsPanel>
      <StatsPanel title="Empty">
        <Bar
          label="Plays per month"
          data={[]}
          format={count}
          columns={["Month", "Plays"]}
          empty="Nothing in this range."
        />
      </StatsPanel>
      <StatsPanel title="Loading">
        <Bar
          label="Plays per month"
          data={[]}
          format={count}
          columns={["Month", "Plays"]}
          empty="Nothing in this range."
          loading
        />
      </StatsPanel>
    </div>
  );
}

const meta = {
  title: "Charts/Bar",
  component: States,
} satisfies Meta<typeof States>;

export default meta;

export const State: StoryObj<typeof meta> = {};
