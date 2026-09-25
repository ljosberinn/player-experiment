import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen, userEvent, within } from "storybook/test";
import { LIBRARY, PLAYLISTS } from "../../../.storybook/fixtures";
import type { Track } from "../../ipc";
import { useLastfmStore } from "../lastfm/store";
import { useLibraryStore } from "../library/store";
import { usePlaylistsStore } from "../playlists/store";
import { AppMenus } from "./AppMenus";

/** Four songs of one album, as a shift-click over the table would select them. */
const SELECTED: Track[] = LIBRARY.slice(7, 11);

function select(tracks: Track[]) {
  useLibraryStore.setState({
    selection: { ids: new Set(tracks.map((entry) => entry.id)), anchorIndex: 7 },
  });
}

async function open(canvasElement: HTMLElement, name: string) {
  await userEvent.click(within(canvasElement).getByRole("menuitem", { name }));
  await screen.findByRole("menu", { name });
}

const meta = {
  title: "Features/Shell/AppMenus",
  component: AppMenus,
  args: { onRemoveMissing: fn(), onSettings: fn(), onExport: fn() },
  decorators: [
    (Story) => (
      <div className="appbar" style={{ marginTop: 24 }}>
        <Story />
      </div>
    ),
  ],
  beforeEach: () => {
    // The page the selection sits on is cached, so Edit can tell what it holds.
    useLibraryStore.setState({
      pages: new Map([[0, LIBRARY]]),
      stats: {
        tracks: LIBRARY.length,
        durationMs: 9_120_000,
        bytes: 412_000_000,
        missing: 1,
        removed: 0,
      },
    });
    usePlaylistsStore.setState({ playlists: PLAYLISTS });
    useLastfmStore.setState({ configured: true, username: "orchard_ears" });
  },
} satisfies Meta<typeof AppMenus>;

export default meta;

/** Edit with nothing to act on. */
export const NoSelection: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    await open(canvasElement, "Edit");
  },
};

export const SeveralSelected: StoryObj<typeof meta> = {
  beforeEach: () => {
    select(SELECTED);
  },
  play: async ({ canvasElement }) => {
    await open(canvasElement, "Edit");
  },
};

/** Inside a static playlist, where Edit can take the songs out of it. */
export const InsideAPlaylist: StoryObj<typeof meta> = {
  beforeEach: () => {
    useLibraryStore.setState({ playlistId: 1 });
    select(SELECTED);
  },
  play: async ({ canvasElement }) => {
    await open(canvasElement, "Edit");
  },
};
