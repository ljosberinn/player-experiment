import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { BUILT_INS, PLAYLISTS } from "../../../.storybook/fixtures";
import { libraryHandlers } from "../../../.storybook/handlers";
import type { Playlist } from "../../ipc";
import { usePlaylistsStore } from "../playlists/store";
import { SongTable } from "./SongTable";
import { useLibraryStore } from "./store";

const meta = {
  title: "Features/Library/SongTable",
  component: SongTable,
  args: { onActivate: fn(), onRemoveFromLibrary: fn(), onExport: fn() },
  parameters: { ipc: libraryHandlers },
  decorators: [
    // The virtualizer draws only the rows its parent has room for, and none
    // at a height of 0.
    (Story) => (
      <main className="content" style={{ height: 720 }}>
        <Story />
      </main>
    ),
  ],
  beforeEach: async () => {
    // For the row menu's Add to Playlist.
    const playlists = [...BUILT_INS, ...PLAYLISTS];
    usePlaylistsStore.setState({ playlists });
    useLibraryStore.getState().setBuiltIns(playlists);
    await useLibraryStore.getState().refresh();
  },
} satisfies Meta<typeof SongTable>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WholeLibrary: Story = {};

/** Longest first, from two clicks on Duration. */
export const Sorted: Story = {
  beforeEach: async () => {
    const { toggleSort } = useLibraryStore.getState();
    await toggleSort("durationMs");
    await toggleSort("durationMs");
  },
};

/** Three songs of Night Transit, as a shift-click selects them. */
export const SeveralSelected: Story = {
  beforeEach: () => {
    useLibraryStore.setState({ selection: { ids: new Set([102, 103, 104]), anchorIndex: 7 } });
  },
};

/** Sodium playing, and Gathering's file gone. */
export const PlayingAndMissing: Story = {
  args: { nowPlayingId: 102 },
};

/** Late Night in its own order, so its rows can be dragged into another. */
export const InsideAPlaylist: Story = {
  args: { onReorder: fn(), onRemove: fn() },
  beforeEach: async () => {
    await useLibraryStore.getState().showPlaylist(PLAYLISTS[0] as Playlist);
  },
};
