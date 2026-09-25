import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatRow } from "./StatRow";
import { StatTiles } from "./StatTiles";

/**
 * Both of section 4a's drawings, which share `StatFigure`: a word unit takes a
 * space and a symbol does not, and a figure without a unit is the value alone.
 */
function Figures() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24, maxWidth: 760 }}>
      <StatRow
        figures={[
          { label: "Songs", value: "12,408" },
          { label: "Listening time", value: "1.5", unit: "yrs" },
          { label: "On disk", value: "412.7", unit: "GB" },
          { label: "Tagged", value: "68", unit: "%" },
        ]}
      />
      <StatTiles
        tiles={[
          { label: "Plays", value: "48,211", caption: "Since March 2011" },
          { label: "Listening time", value: "132", unit: "days", caption: "3.2 hours a day" },
          { label: "Scrobbled", value: "97", unit: "%", caption: "+4% on last year", delta: true },
          { label: "Artists", value: "1,904" },
          {
            label: "Longest session",
            value: "11 h 42 min",
            caption: "Saturday 14 June 2025, most of it one album on repeat",
          },
          { label: "Skipped", value: "1,234,567,890", unit: "tracks" },
        ]}
      />
    </div>
  );
}

const meta = {
  title: "Primitives/StatRow and StatTiles",
  component: Figures,
} satisfies Meta<typeof Figures>;

export default meta;

export const State: StoryObj<typeof meta> = {};
