import type { Meta, StoryObj } from "@storybook/react-vite";
import { emitEvent } from "../../../.storybook/tauri";
import type { WriteProgress } from "../../ipc";
import { useExportStore } from "../export/store";
import { useLastfmStore } from "../lastfm/store";
import { TaskProgress } from "./TaskProgress";

/**
 * At the head of the content pane, beside where `ScanBar` would be. A tag
 * write has no state here: it reports in the dialog that started it.
 */
function Pane() {
  return (
    <main className="content" style={{ height: 160 }}>
      <TaskProgress />
    </main>
  );
}

const meta = {
  title: "Features/Shell/TaskProgress",
  component: Pane,
} satisfies Meta<typeof Pane>;

export default meta;

export const Idle: StoryObj<typeof meta> = {};

/** The save dialog has closed and the first page has not been read yet. */
export const ExportStarting: StoryObj<typeof meta> = {
  beforeEach: () => {
    useExportStore.setState({ busy: true });
  },
};

export const Exporting: StoryObj<typeof meta> = {
  beforeEach: () => {
    useExportStore.setState({ busy: true });
  },
  play: async () => {
    const progress: WriteProgress = { done: 2_400, total: 9_118 };
    await emitEvent("export://progress", progress);
  },
};

/** Its subscription is the last.fm store's, so the progress is seeded rather than sent. */
export const ImportingScrobbles: StoryObj<typeof meta> = {
  beforeEach: () => {
    useLastfmStore.setState({ importing: true, importProgress: { done: 18_200, total: 64_551 } });
  },
};
