import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatsPanel } from "../../features/stats/panels/StatsPanel";
import { BarList } from "./BarList";

const ARTISTS = [
  { key: "Boards of Canada", value: 842 },
  { key: "Aphex Twin", value: 611 },
  { key: "Burial", value: 397 },
];

/** Ten rows, the names long enough that the panel's width cuts them. */
const ALBUMS = [
  { key: "Music Has the Right to Children", secondary: "Boards of Canada", value: 412 },
  { key: "Selected Ambient Works 85–92", secondary: "Aphex Twin", value: 377 },
  { key: "Untrue", secondary: "Burial", value: 301 },
  {
    key: "The Disintegration Loops I–IV (Remastered and Expanded Edition)",
    secondary: "William Basinski",
    value: 256,
  },
  { key: "Geogaddi", secondary: "Boards of Canada", value: 190 },
  {
    key: "A Hundred Days Off",
    secondary: "Underworld featuring a very long credit line that will not fit",
    value: 144,
  },
  { key: "Dummy", secondary: "Portishead", value: 97 },
  { key: "Mezzanine", secondary: "Massive Attack", value: 61 },
  { key: "Endtroducing.....", secondary: "DJ Shadow", value: 22 },
  { key: "Hex", secondary: "Bark Psychosis", value: 3 },
];

const plays = (value: number) => value.toLocaleString();

/** Every state `BarList` draws, each in the panel box the app puts it in. */
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
      <StatsPanel title="Short list">
        <BarList entries={ARTISTS} format={plays} empty="Nothing in this range." />
      </StatsPanel>
      <StatsPanel title="Long list, rows that drill">
        <BarList
          entries={ALBUMS}
          format={plays}
          onSelect={() => undefined}
          caption="Genre known for 84% of plays."
          empty="Nothing in this range."
        />
      </StatsPanel>
      <StatsPanel title="Empty">
        <BarList entries={[]} format={plays} empty="Nothing in this range." />
      </StatsPanel>
      <StatsPanel title="Loading">
        <BarList entries={[]} format={plays} empty="Nothing in this range." loading />
      </StatsPanel>
    </div>
  );
}

const meta = {
  title: "Charts/BarList",
  component: States,
} satisfies Meta<typeof States>;

export default meta;

export const State: StoryObj<typeof meta> = {};
