import type { Meta, StoryObj } from "@storybook/react-vite";
import { PLAYLISTS } from "../../../.storybook/fixtures";
import { emptyStatsHandlers, statsHandlers } from "../../../.storybook/handlers";
import { useLibraryStore } from "../library/store";
import { usePlaylistsStore } from "../playlists/store";
import { type StatsTab, statsRoot } from "./path";
import { StatisticsView } from "./StatisticsView";

/** Where the view opens, through the navigation the sidebar and the tabs use. */
async function openOn(tab: StatsTab) {
  usePlaylistsStore.setState({ playlists: PLAYLISTS });
  await useLibraryStore.getState().showStatsPath(statsRoot(tab));
}

const meta = {
  title: "Features/Statistics/StatisticsView",
  component: StatisticsView,
  parameters: { ipc: statsHandlers },
  decorators: [
    // `.stats-view` scrolls itself, so it needs a pane with a height.
    (Story) => (
      <main className="content" style={{ height: "100vh" }}>
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof StatisticsView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Library: Story = {
  beforeEach: () => openOn("library"),
};

export const EmptyLibrary: Story = {
  parameters: { ipc: emptyStatsHandlers },
  beforeEach: () => openOn("library"),
};

export const Listening: Story = {
  beforeEach: () => openOn("listening"),
};

export const NoPlays: Story = {
  parameters: { ipc: emptyStatsHandlers },
  beforeEach: () => openOn("listening"),
};
