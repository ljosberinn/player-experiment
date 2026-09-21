import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SegmentedControl } from "./SegmentedControl";
import { Slider } from "./Slider";

const TABS = [
  { value: "listening", label: "Listening" },
  { value: "library", label: "Library" },
] as const;

const GROUPINGS = [
  { value: "release", label: "Release" },
  { value: "artist", label: "Artist" },
  { value: "genre", label: "Genre" },
] as const;

/** The sheet's last row: a segmented control and a slider, side by side. */
function Row() {
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("listening");
  const [grouping, setGrouping] = useState<(typeof GROUPINGS)[number]["value"]>("release");
  const [level, setLevel] = useState(58);

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <SegmentedControl
          name="story-tab"
          label="Statistics tab"
          value={tab}
          segments={TABS}
          onChange={setTab}
        />
        <div style={{ flex: 1, minWidth: 150 }}>
          <Slider label="Level" value={level} onChange={setLevel} />
        </div>
      </div>

      {/* Three segments, to show the line between them rather than the one
          between two - and the ring on a selected segment, which has to be
          taken back off its own fill. */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <SegmentedControl
          name="story-grouping"
          label="Grouping"
          value={grouping}
          segments={GROUPINGS}
          onChange={setGrouping}
        />
        <div style={{ flex: 1, minWidth: 150 }}>
          <Slider
            label="Disabled level"
            value={30}
            disabled
            onChange={() => undefined}
            format={(reading) => `${reading} dB`}
          />
        </div>
      </div>

      <p style={{ margin: 0, color: "var(--muted)", fontSize: 11.5 }}>
        The segments are native radios under the drawing, so the set is one tab stop and the arrow
        keys move through it. Tab into it and try them; a selected segment takes its focus ring back
        in <code>--on-accent</code>, the accent being what it is filled with.
      </p>
    </div>
  );
}

const meta = {
  title: "Primitives/SegmentedControl and Slider",
  component: Row,
} satisfies Meta<typeof Row>;

export default meta;

export const Choices: StoryObj<typeof meta> = {};
