import type { Meta, StoryObj } from "@storybook/react-vite";
import { PLAYLISTS } from "../../../.storybook/fixtures";
import { libraryHandlers, playlistHandlers } from "../../../.storybook/handlers";
import { AppBar } from "../../components/ui/AppBar";
import type { Playlist } from "../../ipc";
import { usePlaylistsStore } from "../playlists/store";
import { SearchBox } from "./SearchBox";
import { useLibraryStore } from "./store";

/** In the bar, which is what gives the field its width. */
function Bar() {
  return (
    <AppBar>
      <SearchBox />
    </AppBar>
  );
}

const meta = {
  title: "Features/Library/SearchBox",
  component: Bar,
  // Typing runs the search, and Escape clears it.
  parameters: { ipc: { ...libraryHandlers, ...playlistHandlers } },
} satisfies Meta<typeof Bar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithATerm: Story = {
  beforeEach: async () => {
    useLibraryStore.getState().setSearch("harbour");
    await useLibraryStore.getState().commitSearch();
  },
};

/** Scoped to Late Night, and saying so. */
export const InsideAPlaylist: Story = {
  beforeEach: async () => {
    await usePlaylistsStore.getState().load();
    await useLibraryStore.getState().showPlaylist(PLAYLISTS[0] as Playlist);
  },
};
