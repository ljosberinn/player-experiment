import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { LIBRARY } from "../../../.storybook/fixtures";
import { libraryHandlers } from "../../../.storybook/handlers";
import type { Track } from "../../ipc";
import { ReleaseGroups } from "./ReleaseGroups";
import { useLibraryStore } from "./store";

function byId(id: number): Track {
  return LIBRARY.find((entry) => entry.id === id) as Track;
}

const meta = {
  title: "Features/Library/ReleaseGroups",
  component: ReleaseGroups,
  args: { onActivate: fn(), onRemoveFromLibrary: fn(), onExport: fn() },
  parameters: { ipc: libraryHandlers },
  decorators: [
    // `SongTable`'s reason: the virtualizer needs a parent with a height.
    (Story) => (
      <main className="content" style={{ height: 720 }}>
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof ReleaseGroups>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The Lanterns: the uncovered demos, then the album. */
export const SeveralReleases: Story = {
  beforeEach: async () => {
    await useLibraryStore.getState().showTrackArtist(byId(1));
  },
};

/** Night Transit, opened from its tile, in track order. */
export const OneRelease: Story = {
  args: { nowPlayingId: 102 },
  beforeEach: async () => {
    await useLibraryStore.getState().showTrackGroup(byId(101));
  },
};
