import type { Meta, StoryObj } from "@storybook/react-vite";
import { WriteLine } from "./WriteLine";

/** Before the first event, part way through the files, and the library transaction after them. */
function States() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 22 }}>
      <WriteLine progress={null} />
      <WriteLine progress={{ done: 1_204, total: 3_310 }} />
      <WriteLine progress={{ done: 3_310, total: 3_310 }} />
    </div>
  );
}

const meta = {
  title: "Features/Editor/WriteLine",
  component: States,
} satisfies Meta<typeof States>;

export default meta;

export const State: StoryObj<typeof meta> = {};
