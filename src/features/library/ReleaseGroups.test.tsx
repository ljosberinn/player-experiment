import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseGroup, SortField, Track, TrackQuery } from "../../ipc";
import { queryTracks } from "../../ipc";
import { albumIdentity } from "./browse";
import { ReleaseGroups } from "./ReleaseGroups";
import { useLibraryStore } from "./store";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));

vi.mock("../../ipc", () => ({
  countTracks: vi.fn(),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0, removed: 0 })),
  queryTracks: vi.fn(),
  allTrackIds: vi.fn(async () => []),
  browseGroups: vi.fn(async () => []),
  releaseGroups: vi.fn(async () => []),
  revealTrack: vi.fn(async () => undefined),
  listPlaylists: vi.fn(async () => []),
  addToPlaylist: vi.fn(async () => 1),
  tracksByIds: vi.fn(async () => []),
  loadColumnConfig: vi.fn(async () => null),
  saveColumnConfig: vi.fn(async () => undefined),
  coverUrl: (hash: string) => `cover://${hash}`,
}));

const COLUMN_IDS: SortField[] = ["trackNo", "title", "durationMs"];
const BODY_HEIGHT = 900;

function track(id: number): Track {
  return {
    id,
    path: `/m/${id}.mp3`,
    duration_ms: 200_000,
    title: `Track ${id}`,
    artist: "Grizzly Bear",
    album: "Shields",
    album_artist: null,
    genre: null,
    year: 2012,
    track_no: id + 1,
    disc_no: null,
    comment: null,
    bitrate: null,
    sample_rate: null,
    cover_hash: null,
    added_at: 0,
    play_count: 0,
    last_played_at: null,
    missing_since: null,
    release_group_mbid: null,
  };
}

function release(
  title: string,
  trackCount: number,
  over: Partial<ReleaseGroup> = {},
): ReleaseGroup {
  return {
    id: albumIdentity(title, "Grizzly Bear"),
    title,
    artist: "Grizzly Bear",
    year: 2012,
    coverHash: null,
    trackCount,
    durationMs: trackCount * 200_000,
    format: "MP3",
    bitrate: 320,
    ...over,
  };
}

const initial = useLibraryStore.getState();

// jsdom gives every element zero height, so the virtualizer would render no
// groups. Pin a real viewport size for the scroll container.
function stubLayout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    height: BODY_HEIGHT,
    width: 800,
    top: 0,
    left: 0,
    bottom: BODY_HEIGHT,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: BODY_HEIGHT,
  });
}

/** Puts the store in a drill-in over `releases`, with no page fetched yet. */
function drilledInto(releases: ReleaseGroup[]) {
  useLibraryStore.setState({
    ...initial,
    columns: { ids: COLUMN_IDS, widths: {} },
    fittedWidths: {},
    fitPending: false,
    browse: { kind: "albums", id: releases[0]?.id ?? null },
    releases,
    total: releases.reduce((sum, one) => sum + one.trackCount, 0),
    pages: new Map(),
    inFlight: new Set(),
    selection: { ids: new Set(), anchorIndex: null },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  stubLayout();
  vi.mocked(queryTracks).mockImplementation(async (query: TrackQuery) =>
    Array.from({ length: query.limit }, (_, i) => track(query.offset + i)),
  );
});

/** Renders the drill-in and waits for its rows to land. */
async function settled(releases: ReleaseGroup[]) {
  drilledInto(releases);
  render(<ReleaseGroups />);
  await act(async () => {
    await useLibraryStore.getState().ensureRange(0, 20);
  });
  await waitFor(() => expect(document.querySelectorAll("tr.song-row").length).toBeGreaterThan(0));
}

describe("a drill-in drawn as release groups", () => {
  it("draws one group per release, oldest first, as the query returned them", async () => {
    await settled([release("Yellow House", 2, { year: 2006 }), release("Shields", 3)]);

    const titles = [...document.querySelectorAll(".release-title")].map((one) => one.textContent);
    expect(titles).toEqual(["Yellow House", "Shields"]);
  });

  it("names the release, its year and its format in the gutter", async () => {
    await settled([release("Shields", 2)]);

    const gutter = document.querySelector(".release-gutter") as HTMLElement;
    expect(gutter.textContent).toContain("Shields");
    expect(gutter.textContent).toContain("2012");
    expect(gutter.textContent).toContain("MP3 · 320 kbps");
  });

  it("numbers rows across the whole view, not within a group", async () => {
    await settled([release("Yellow House", 2, { year: 2006 }), release("Shields", 3)]);

    // The selection, the row menu and the play queue are all indexed into the
    // one query behind every group. A per-group index would make the second
    // group act on the first group's rows.
    const indices = [...document.querySelectorAll("tr.song-row")].map((one) =>
      one.getAttribute("aria-rowindex"),
    );
    expect(indices).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("closes each group with its own count and duration", async () => {
    await settled([release("Shields", 3)]);

    const footer = document.querySelector(".release-total") as HTMLElement;
    expect(footer.textContent).toContain("3 songs");
    expect(footer.textContent).toContain("10:00");
  });

  it("draws one column header above the groups rather than one per group", async () => {
    await settled([release("Yellow House", 2, { year: 2006 }), release("Shields", 3)]);

    // The gutter is a fixed width, so every group's table starts at the same
    // x and one header is that inset.
    expect(screen.getAllByRole("columnheader", { name: "Name" })).toHaveLength(1);
  });

  it("fetches exactly the rows the groups on screen own", async () => {
    drilledInto([release("Yellow House", 2, { year: 2006 }), release("Shields", 3)]);
    render(<ReleaseGroups />);

    await waitFor(() => expect(vi.mocked(queryTracks)).toHaveBeenCalled());
    const asked = vi.mocked(queryTracks).mock.calls.map(([query]) => query.offset);
    // One page covers all five rows; what matters is that it starts at the
    // first row of the first visible group rather than at a row read off a
    // group that has not been drawn.
    expect(asked).toEqual([0]);
  });
});
