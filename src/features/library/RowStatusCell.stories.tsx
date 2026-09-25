import type { Meta, StoryObj } from "@storybook/react-vite";
import { track } from "../../../.storybook/fixtures";
import { RowStatusCell } from "./RowStatusCell";
import { ROW_HEIGHT } from "./SongRow";

const PRESENT = track({ title: "Low Tide" });
const MISSING = track({
  title: "Sodium",
  path: "E:\\Music\\Mira Kohl\\Night Transit\\02 Sodium.flac",
  missing_since: 1_772_280_000,
});

const ROWS = [
  { label: "Playing", track: PRESENT, playing: true, selected: false },
  { label: "Missing", track: MISSING, playing: false, selected: false },
  { label: "Neither", track: PRESENT, playing: false, selected: false },
  { label: "Page not arrived (track={null})", track: null, playing: false, selected: false },
  { label: "Playing, selected", track: PRESENT, playing: true, selected: true },
  { label: "Missing, selected", track: MISSING, playing: false, selected: true },
];

/**
 * The first cell of a song row in each state, in the table's own row markup.
 * A selected row takes the colour off both marks, so those are drawn too.
 * Hover the missing mark for the path.
 */
function Cells() {
  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      <table className="song-table">
        <tbody style={{ height: ROWS.length * ROW_HEIGHT }}>
          {ROWS.map((row, index) => (
            <tr
              key={row.label}
              className={["song-row", row.selected ? "selected" : "", row.playing ? "playing" : ""]
                .filter(Boolean)
                .join(" ")}
              style={{ height: ROW_HEIGHT, transform: `translateY(${index * ROW_HEIGHT}px)` }}
            >
              <RowStatusCell track={row.track} playing={row.playing} />
              <td className="song-cell" data-column="title">
                {row.label}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const meta = {
  title: "Features/Library/RowStatusCell",
  component: Cells,
} satisfies Meta<typeof Cells>;

export default meta;

export const State: StoryObj<typeof meta> = {};
