import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { BUILT_INS } from "../../../.storybook/fixtures";
import { libraryHandlers, playlistHandlers } from "../../../.storybook/handlers";
import { useLibraryStore } from "../../features/library/store";
import { usePlaylistsStore } from "../../features/playlists/store";
import type { Playlist } from "../../ipc";
import { LibraryNav } from "./LibraryNav";
import { Sidebar } from "./Sidebar";

/** Wired to the library store as `App` wires it, so a click opens the view. */
function Nav({ onExport }: { onExport?: (playlist: Playlist) => void }) {
  const tab = useLibraryStore((s) => s.tab);
  const playlistId = useLibraryStore((s) => s.playlistId);
  const showTab = useLibraryStore((s) => s.showTab);
  return (
    <div className="body" style={{ height: 420 }}>
      <Sidebar>
        <LibraryNav
          active={playlistId === null ? tab : null}
          onSelect={(view) => void showTab(view)}
          onExport={onExport}
        />
      </Sidebar>
    </div>
  );
}

const meta = {
  title: "Features/Library/LibraryNav",
  component: Nav,
  args: { onExport: fn() },
  parameters: { ipc: { ...libraryHandlers, ...playlistHandlers } },
} satisfies Meta<typeof Nav>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The frame before `list_playlists` answers: the views, and no built-ins yet. */
export const BeforeThePlaylists: Story = {};

export const Songs: Story = {
  beforeEach: async () => {
    await usePlaylistsStore.getState().load();
  },
};

/** Most Played open, so no view is. */
export const ABuiltInOpen: Story = {
  beforeEach: async () => {
    await usePlaylistsStore.getState().load();
    await useLibraryStore.getState().showPlaylist(BUILT_INS[1] as Playlist);
  },
};
