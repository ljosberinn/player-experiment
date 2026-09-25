import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { BUILT_INS, LIBRARY } from "../.storybook/fixtures";
import {
  appHandlers,
  crashHandlers,
  editingHandlers,
  emptyStatsHandlers,
  libraryHandlers,
  playerHandlers,
  playlistHandlers,
  reviewHandlers,
  SILENT,
  shellHandlers,
  statsHandlers,
} from "../.storybook/handlers";
import type { IpcHandlers } from "../.storybook/tauri";
import { App } from "./App";
import type { LibraryFolder, LibraryStats, PlayerSnapshot, Track } from "./ipc";

const PLAYING_TRACK = LIBRARY.find((entry) => entry.id === 1) as Track;

const PLAYING: PlayerSnapshot = {
  ...SILENT,
  status: "playing",
  track: PLAYING_TRACK,
  queueIndex: 0,
  queueLen: LIBRARY.length,
  positionMs: Math.round((PLAYING_TRACK.duration_ms ?? 0) / 3),
  durationMs: PLAYING_TRACK.duration_ms ?? 0,
};

/** Every area's map, so a click anywhere in the window is answered. */
const everything: IpcHandlers = {
  ...crashHandlers,
  ...playerHandlers,
  ...shellHandlers,
  ...libraryHandlers,
  ...playlistHandlers,
  ...reviewHandlers,
  ...editingHandlers,
  ...statsHandlers,
  ...appHandlers,
  // `crashHandlers` reports a crash, whose alert would make the window inert.
  last_crash: () => null,
  player_snapshot: () => PLAYING,
};

/** A first launch: no folder picked, nothing scanned, nothing played. */
const firstRun: IpcHandlers = {
  ...everything,
  ...emptyStatsHandlers,
  player_snapshot: () => SILENT,
  query_tracks: () => [],
  all_track_ids: () => [],
  library_stats: (): LibraryStats => ({
    tracks: 0,
    durationMs: 0,
    bytes: 0,
    missing: 0,
    removed: 0,
  }),
  browse_groups: () => [],
  release_groups: () => [],
  count_tracks: () => 0,
  load_library_folder: (): LibraryFolder => ({ root: null, organize: false }),
  list_watch_folders: () => [],
  list_playlists: () => BUILT_INS.map((playlist) => ({ ...playlist, trackCount: 0 })),
  tagsource_review_counts: () => ({ review: 0, aside: 0 }),
};

const meta = {
  title: "App",
  component: App,
  parameters: { ipc: everything },
} satisfies Meta<typeof App>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Library: Story = {};

export const Statistics: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "Statistics" }));
  },
};

export const FirstRun: Story = {
  parameters: { ipc: firstRun },
};
