import { act, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listPlaylists, type Playlist } from "../../ipc";
import { useLibraryStore } from "../library/store";
import { PlaylistSidebar } from "./PlaylistSidebar";
import { usePlaylistsStore } from "./store";

/**
 * What opening a playlist re-renders in the sidebar.
 *
 * Counted as `ContextMenu` renders, one per row: each row's menu is a Base UI
 * tree of its own, which is what react-scan lit up for every row on every
 * switch while the rows were built inline.
 */

vi.mock("../../ipc", () => ({
  INVALIDATE_DEBOUNCE_MS: 250,
  listPlaylists: vi.fn(),
  loadSidebarSections: vi.fn(async () => null),
  saveSidebarSections: vi.fn(async () => undefined),
  saveView: vi.fn(async () => undefined),
  onLibraryChanged: vi.fn(async () => () => {}),
  countTracks: vi.fn(async () => 0),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0, removed: 0 })),
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
  loadColumnConfig: vi.fn(async () => null),
  playlistOrder: vi.fn(async () => ({ sort: null, limit: null })),
}));

const menus = vi.hoisted(() => ({ renders: [] as (string | undefined)[] }));

vi.mock("../../components/ui/ContextMenu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/ui/ContextMenu")>();
  return {
    ...actual,
    ContextMenu: (props: Parameters<typeof actual.ContextMenu>[0]) => {
      menus.renders.push(props.label);
      return createElement(actual.ContextMenu, props);
    },
  };
});

function playlist(id: number, name: string, kind: Playlist["kind"] = "smart"): Playlist {
  return { id, name, kind, trackCount: 4, createdAt: 0, builtIn: null };
}

const LISTS = [
  playlist(1, "Evening"),
  playlist(2, "Focus"),
  playlist(3, "Loud"),
  playlist(4, "Road", "static"),
];

const initialLibrary = useLibraryStore.getState();
const initialPlaylists = usePlaylistsStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({ ...initialLibrary, playlistId: null });
  usePlaylistsStore.setState({ ...initialPlaylists, playlists: [], collapsed: {} });
  vi.mocked(listPlaylists).mockResolvedValue(LISTS);
});

async function open(target: Playlist | null) {
  await act(async () => {
    await useLibraryStore.getState().showPlaylist(target);
  });
}

describe("what opening a playlist re-renders", () => {
  it("the two rows whose highlight moved, and no other", async () => {
    render(<PlaylistSidebar />);
    await screen.findByRole("button", { name: "Road" });
    await open(LISTS[0] ?? null);
    menus.renders = [];

    await open(LISTS[1] ?? null);

    expect(menus.renders.sort()).toEqual(["Evening actions", "Focus actions"]);
  });
});
