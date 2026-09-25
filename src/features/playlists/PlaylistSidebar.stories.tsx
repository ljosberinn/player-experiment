import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen, userEvent, within } from "storybook/test";
import { BUILT_INS } from "../../../.storybook/fixtures";
import { libraryHandlers, playlistHandlers } from "../../../.storybook/handlers";
import { rightClick } from "../../../.storybook/play";
import { Sidebar } from "../../components/ui/Sidebar";
import type { Playlist } from "../../ipc";
import { PlaylistSidebar } from "./PlaylistSidebar";
import { usePlaylistsStore } from "./store";

/** In the sidebar, which is what lays out its sections. */
function Source({ onExport }: { onExport?: (playlist: Playlist) => void }) {
  return (
    <div className="body" style={{ height: 480 }}>
      <Sidebar>
        <PlaylistSidebar onExport={onExport} />
      </Sidebar>
    </div>
  );
}

const meta = {
  title: "Features/Playlists/PlaylistSidebar",
  component: Source,
  args: { onExport: fn() },
  // It loads its own playlists; a click on one opens it, which queries.
  parameters: { ipc: { ...libraryHandlers, ...playlistHandlers } },
} satisfies Meta<typeof Source>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playlists: Story = {};

/** Only the built-ins, which `LibraryNav` draws instead. */
export const None: Story = {
  parameters: { ipc: { list_playlists: () => BUILT_INS } },
};

export const SmartFolded: Story = {
  parameters: { ipc: { load_sidebar_sections: () => JSON.stringify({ smart: true }) } },
};

/** Late Night being renamed in place, as a double-click starts. */
export const Renaming: Story = {
  beforeEach: () => {
    usePlaylistsStore.setState({ renaming: 1 });
  },
};

export const ConfirmingDelete: Story = {
  play: async ({ canvasElement }) => {
    const row = await within(canvasElement).findByRole("button", { name: "Late Night" });
    await rightClick(row);
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await screen.findByRole("alertdialog");
  },
};
