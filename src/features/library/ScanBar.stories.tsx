import type { Meta, StoryObj } from "@storybook/react-vite";
import { emitEvent } from "../../../.storybook/tauri";
import type { ScanProgress } from "../../ipc";
import { ScanBar } from "./ScanBar";

/** At the head of the content pane, where `App` mounts it. */
function Pane() {
  return (
    <main className="content" style={{ height: 160 }}>
      <ScanBar />
    </main>
  );
}

const meta = {
  title: "Features/Library/ScanBar",
  component: Pane,
} satisfies Meta<typeof Pane>;

export default meta;

/** No scan running: nothing drawn. */
export const Idle: StoryObj<typeof meta> = {};

export const Scanning: StoryObj<typeof meta> = {
  play: async () => {
    const progress: ScanProgress = {
      scanned: 4_812,
      total: 12_630,
      added: 311,
      updated: 27,
      missing: 2,
      done: false,
    };
    await emitEvent("scan://progress", progress);
  },
};
