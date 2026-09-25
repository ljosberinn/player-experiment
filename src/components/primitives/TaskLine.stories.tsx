import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProgressBar } from "./ProgressBar";
import { TaskLine } from "./TaskLine";

/** The sidebar's width less its padding, which is where the task line sits. */
const SIDEBAR = 229;

/** A rail from untouched to full, and the task line at the foot of the sidebar. */
function States() {
  return (
    <div style={{ padding: 24, display: "flex", flexWrap: "wrap", gap: 40 }}>
      <div style={{ width: SIDEBAR, display: "flex", flexDirection: "column", gap: 22 }}>
        <TaskLine headline="Looking up and filing releases" estimate={null} ratio={0} />
        <TaskLine
          headline="Looking up and filing releases · 0.22%"
          estimate="about 2 days left"
          ratio={0.0022}
        />
        <TaskLine
          headline="Looking up and filing releases · 57.40%"
          estimate="about 19 hours left"
          ratio={0.574}
        />
        <TaskLine headline="Looking up and filing releases · 100.00%" estimate={null} ratio={1} />
      </div>

      {/* Alone, at the width the review pane gives it. A sliver is drawn at
          three pixels, so "started" and "not started" stay apart. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <ProgressBar ratio={0} width={62} />
        <ProgressBar ratio={0.0022} width={62} />
        <ProgressBar ratio={0.574} width={62} />
        <ProgressBar ratio={1} width={62} />
      </div>
    </div>
  );
}

const meta = {
  title: "Primitives/TaskLine and ProgressBar",
  component: States,
} satisfies Meta<typeof States>;

export default meta;

export const State: StoryObj<typeof meta> = {};
