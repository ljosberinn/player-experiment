import type { Meta, StoryObj } from "@storybook/react-vite";
import { BarList } from "../../../components/charts/BarList";
import { StatsPanel } from "./StatsPanel";

const ENTRIES = [
  { key: "Electronic", value: 1840 },
  { key: "Rock", value: 1120 },
  { key: "Jazz", value: 640 },
];

const plays = (value: number) => value.toLocaleString();

/** The box every panel sits in: a heading alone, one with its own control, and one with a caption. */
function States() {
  return (
    <div className="stats-panels" style={{ maxWidth: 520 }}>
      <StatsPanel title="Top genres">
        <BarList entries={ENTRIES} format={plays} empty="Nothing in this range." />
      </StatsPanel>
      <StatsPanel
        title="Genres"
        action={
          <button type="button" className="stats-action">
            Fix a parent…
          </button>
        }
      >
        <BarList entries={ENTRIES} format={plays} empty="Nothing in this range." />
      </StatsPanel>
      <StatsPanel title="When you listen" caption="Date known for 91% of plays.">
        <BarList entries={ENTRIES} format={plays} empty="Nothing in this range." />
      </StatsPanel>
    </div>
  );
}

const meta = {
  title: "Charts/StatsPanel",
  component: States,
} satisfies Meta<typeof States>;

export default meta;

export const State: StoryObj<typeof meta> = {};
