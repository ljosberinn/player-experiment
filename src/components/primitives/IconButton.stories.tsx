import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./IconButton";

/** The four places, the toggled state, and the hit area the 20px one keeps. */
function Places() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <IconButton icon="play" label="Play" />
        <IconButton icon="review" label="Review matches" />
        <IconButton icon="repeat-one" label="Repeat one" pressed />
        <IconButton icon="songs" label="Songs" disabled />
        <span style={{ marginLeft: 6, color: "var(--muted)", fontSize: 11.5 }}>
          toolbar, 32px · the third is toggled
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <IconButton icon="play" label="Play" place="dialog" />
        <IconButton icon="review" label="Review matches" place="dialog" />
        <IconButton icon="repeat-one" label="Repeat one" place="dialog" pressed />
        <span style={{ marginLeft: 6, color: "var(--muted)", fontSize: 11.5 }}>dialog, 36px</span>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <IconButton icon="remove" label="Remove condition 1" place="rule" />
        <IconButton icon="remove" label="Remove condition 2" place="rule" />
        <span style={{ marginLeft: 6, color: "var(--muted)", fontSize: 11.5 }}>
          filter rule, 30px · muted, and stretched to the row by the grid it sits in
        </span>
      </div>

      {/* Drawn on a rule, which is the row it would sit in. The pair is 20px
          of mark and 24px of target, so the two overlap the line above and
          below and still do not touch each other. */}
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          padding: "6px 0",
          borderTop: "1px solid var(--chrome-border)",
          borderBottom: "1px solid var(--chrome-border)",
        }}
      >
        <IconButton icon="move-up" label="Move up" place="nudge" />
        <IconButton icon="move-down" label="Move down" place="nudge" />
        <span style={{ marginLeft: 6, color: "var(--muted)", fontSize: 11.5 }}>
          mapping row, 20px drawn and 24px pressable
        </span>
      </div>
    </div>
  );
}

const meta = {
  title: "Primitives/Icon button",
  component: Places,
} satisfies Meta<typeof Places>;

export default meta;

export const Place: StoryObj<typeof meta> = {};
