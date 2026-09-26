import type { Meta, StoryObj } from "@storybook/react-vite";
import { LIBRARY } from "../../../.storybook/fixtures";
import { libraryHandlers } from "../../../.storybook/handlers";
import type { LibraryStats, Track } from "../../ipc";
import { useLibraryStore, VIEW_TITLES } from "../library/store";
import { ViewSummaryText } from "./ViewSummaryText";

/**
 * The top of the content pane as `App` lays it out, in each of the three
 * places the summary goes: beside a browse view's heading, on a drill-in's
 * breadcrumb row, and on a line of its own over the Songs table.
 */
function PaneTop() {
  const tab = useLibraryStore((s) => s.tab);
  const browse = useLibraryStore((s) => s.browse);
  return (
    <main className="content" style={{ height: 160 }}>
      {tab !== "songs" && browse === null ? (
        <div className="view-heading">
          <div className="view-heading-title">
            <h1>{VIEW_TITLES[tab]}</h1>
            <ViewSummaryText />
          </div>
          <span className="view-heading-rule" aria-hidden="true" />
        </div>
      ) : null}
      {browse !== null ? (
        <div className="browse-back-row">
          <button type="button" className="browse-back">
            ‹ All {VIEW_TITLES[tab]}
          </button>
          <ViewSummaryText />
        </div>
      ) : tab === "songs" ? (
        <ViewSummaryText className="view-summary-line" />
      ) : null}
    </main>
  );
}

const meta = {
  title: "Features/Shell/ViewSummaryText",
  component: PaneTop,
  parameters: { ipc: libraryHandlers },
} satisfies Meta<typeof PaneTop>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Songs: Story = {
  beforeEach: async () => {
    await useLibraryStore.getState().refresh();
  },
};

export const Releases: Story = {
  beforeEach: async () => {
    await useLibraryStore.getState().showTab("albums");
  },
};

/** Night Transit, opened from its tile. */
export const DrillIn: Story = {
  beforeEach: async () => {
    await useLibraryStore.getState().showTrackGroup(LIBRARY.find((t) => t.id === 101) as Track);
  },
};

/** Nothing drawn: the empty state under it says so in a sentence. */
export const EmptyLibrary: Story = {
  parameters: {
    ipc: {
      query_tracks: () => [],
      library_stats: (): LibraryStats => ({
        tracks: 0,
        durationMs: 0,
        bytes: 0,
        missing: 0,
        removed: 0,
      }),
    },
  },
  beforeEach: async () => {
    await useLibraryStore.getState().refresh();
  },
};
