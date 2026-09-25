import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatsPanel } from "../../features/stats/panels/StatsPanel";
import { Donut, type DonutSlice } from "./Donut";

const drill = () => undefined;

/** Largest first, as `GenreDonut` orders them: the ramp's every step, a derived parent, and slices that go nowhere. */
const GENRES: DonutSlice[] = [
  { key: "electronic", label: "Electronic", value: 1840, onSelect: drill },
  { key: "rock", label: "Rock", value: 1120, onSelect: drill },
  { key: "jazz", label: "Jazz", value: 640, onSelect: drill },
  { key: "hip hop", label: "Hip Hop", value: 402 },
  { key: "ambient", label: "Ambient", value: 288, note: "derived", onSelect: drill },
  { key: "classical", label: "Classical", value: 170 },
  { key: "folk", label: "Folk", value: 96 },
  { key: "soul", label: "Soul", value: 41 },
  { key: " untagged", label: "No genre", value: 212 },
];

const tracks = (value: number) => value.toLocaleString();

/** Every state `Donut` draws, each in the panel box the app puts it in. */
function States() {
  return (
    <div
      style={{
        padding: 24,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
        gap: 20,
      }}
    >
      <StatsPanel title="Many slices">
        <Donut
          label="Songs per genre"
          slices={GENRES}
          format={tracks}
          column="Genre"
          empty="Nothing here has a genre."
        />
      </StatsPanel>
      <StatsPanel title="One slice">
        <Donut
          label="Songs per genre under Shoegaze"
          slices={[{ key: " own", label: "Shoegaze itself", value: 58 }]}
          format={tracks}
          column="Genre"
          empty="Nothing here has a genre."
        />
      </StatsPanel>
      <StatsPanel title="Empty">
        <Donut
          label="Songs per genre"
          slices={[]}
          format={tracks}
          column="Genre"
          empty="Nothing here has a genre."
        />
      </StatsPanel>
      <StatsPanel title="Loading">
        <Donut
          label="Songs per genre"
          slices={[]}
          format={tracks}
          column="Genre"
          empty="Nothing here has a genre."
          loading
        />
      </StatsPanel>
    </div>
  );
}

const meta = {
  title: "Charts/Donut",
  component: States,
} satisfies Meta<typeof States>;

export default meta;

export const State: StoryObj<typeof meta> = {};
