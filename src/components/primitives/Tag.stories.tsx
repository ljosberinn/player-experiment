import type { Meta, StoryObj } from "@storybook/react-vite";
import { Count, Tag } from "./Tag";

/** Every tone the sheet draws, with the labels it draws them under. */
function Tones() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <Tag tone="accent">Lossless</Tag>
        <Tag tone="selection">Smart</Tag>
        <Tag tone="neutral">Missing</Tag>
        <Tag tone="outline">Post-Rock</Tag>
        <Count>242</Count>
      </div>

      {/* The count's `min-width`, which is only visible against a figure that
          does not need it. Both marks are the same shape. */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <Count>7</Count>
        <Count>242</Count>
        <Count>15304</Count>
        <span style={{ marginLeft: 6, color: "var(--muted)", fontSize: 11.5 }}>
          one figure and five, at the same minimum width and in tabular figures
        </span>
      </div>

      {/* A tag is a label on something, and the tone that carries the least
          contrast is the one most likely to be drawn on the wrong surface.
          Three of the app's four grounds, so the neutral veil and the
          selection wash can be read against each. */}
      <div style={{ display: "flex", gap: 1, background: "var(--chrome-border)" }}>
        {["var(--surface)", "var(--chrome)", "var(--sidebar)"].map((behind) => (
          <div
            key={behind}
            style={{ display: "flex", gap: 6, padding: 12, background: behind, flex: 1 }}
          >
            <Tag tone="selection">Smart</Tag>
            <Tag tone="neutral">Missing</Tag>
            <Tag tone="outline">Post-Rock</Tag>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Primitives/Tag",
  component: Tones,
} satisfies Meta<typeof Tones>;

export default meta;

export const Tone: StoryObj<typeof meta> = {};
