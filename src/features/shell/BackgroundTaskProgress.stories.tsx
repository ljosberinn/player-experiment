import type { Meta, StoryObj } from "@storybook/react-vite";
import { emitEvent } from "../../../.storybook/tauri";
import { Sidebar } from "../../components/ui/Sidebar";
import type { BackgroundTask } from "../../ipc";
import { BackgroundTaskProgress } from "./BackgroundTaskProgress";

/** At the foot of the sidebar, which is where its own layout pins it. */
function Foot() {
  return (
    <div className="body" style={{ height: 320 }}>
      <Sidebar>
        <BackgroundTaskProgress />
      </Sidebar>
    </div>
  );
}

const meta = {
  title: "Features/Shell/BackgroundTaskProgress",
  component: Foot,
} satisfies Meta<typeof Foot>;

export default meta;

/** No task: nothing drawn. */
export const Idle: StoryObj<typeof meta> = {};

/** The unattended lookup pass, most of a day from done. */
export const Running: StoryObj<typeof meta> = {
  play: async () => {
    const task: BackgroundTask = {
      label: "Looking up and filing releases",
      done: 1_734,
      total: 8_020,
      etaMs: 19 * 60 * 60 * 1000,
    };
    await emitEvent("task://progress", task);
  },
};
