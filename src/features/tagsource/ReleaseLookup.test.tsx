import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseCandidate, ReleaseDetail, ReleaseSelection, Track } from "../../ipc";
import {
  tagsourceApply,
  tagsourceFetch,
  tagsourceGroups,
  tagsourceSearch,
  tracksByIds,
} from "../../ipc";
import { ReleaseLookup } from "./ReleaseLookup";
import { useTagsourceStore } from "./store";

vi.mock("../../ipc", () => ({
  coverUrl: (hash: string) => `cover-url:${hash}`,
  stagedCoverUrl: (version: string) => `staged-cover-url:${version}`,
  onTagWriteProgress: vi.fn(async () => () => {}),
  tagsourceGroups: vi.fn(),
  tagsourceSearch: vi.fn(),
  tagsourceFetch: vi.fn(),
  tagsourceApply: vi.fn(),
  tracksByIds: vi.fn(),
}));

function track(id: number, over: Partial<Track> = {}): Track {
  return {
    id,
    path: `/m/${id}.mp3`,
    duration_ms: 200_000,
    title: `File ${id}`,
    artist: null,
    album: "loveless",
    album_artist: "MBV",
    genre: null,
    year: null,
    track_no: id,
    disc_no: null,
    comment: null,
    bitrate: null,
    sample_rate: null,
    cover_hash: null,
    added_at: 0,
    play_count: 0,
    last_played_at: null,
    missing_since: null,
    ...over,
  };
}

function candidate(over: Partial<ReleaseCandidate> = {}): ReleaseCandidate {
  return {
    mbid: "bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9",
    releaseGroupMbid: "2c7d1b1a-1a1a-4c4c-8f8f-9a9a9a9a9a9a",
    title: "Loveless",
    artist: "My Bloody Valentine",
    date: "1991-11-04",
    country: "GB",
    format: "CD",
    trackCount: 2,
    discCount: 1,
    score: 0.98,
    ...over,
  };
}

const detail: ReleaseDetail = {
  candidate: candidate(),
  albumArtist: "My Bloody Valentine",
  year: 1991,
  tracks: [
    {
      title: "Only Shallow",
      artist: "My Bloody Valentine",
      trackNo: 1,
      discNo: 1,
      durationMs: 268_000,
    },
    { title: "Loomer", artist: "My Bloody Valentine", trackNo: 2, discNo: 1, durationMs: 148_000 },
  ],
  genre: null,
  releaseType: null,
  coverPath: "/cache/chosen-cover.jpg",
};

const group: ReleaseSelection = { album: "loveless", artist: "MBV", trackIds: [1, 2] };

const initial = useTagsourceStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useTagsourceStore.setState(initial, true);
  vi.mocked(tagsourceGroups).mockResolvedValue([group]);
  vi.mocked(tracksByIds).mockResolvedValue([track(1), track(2)]);
  vi.mocked(tagsourceSearch).mockResolvedValue([candidate()]);
  vi.mocked(tagsourceFetch).mockResolvedValue(detail);
  vi.mocked(tagsourceApply).mockResolvedValue({ written: 2, failed: 0, errors: [] });
});

/** Opens the dialog on one release and waits for its results. */
async function open() {
  render(<ReleaseLookup />);
  await useTagsourceStore.getState().open([1, 2]);
  await screen.findByRole("button", { name: /Loveless/ });
  return userEvent.setup();
}

describe("the results", () => {
  it("draws nothing until a lookup is open", () => {
    render(<ReleaseLookup />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names the release it is on and what it found", async () => {
    await open();

    expect(screen.getByText("loveless")).toBeInTheDocument();
    // The score the list is sorted by, beside the result rather than implied.
    expect(screen.getByText("98%")).toBeInTheDocument();
    expect(screen.getByText(/1991 · GB · CD · 2 tracks/)).toBeInTheDocument();
  });

  it("counts the releases when a selection covers several", async () => {
    vi.mocked(tagsourceGroups).mockResolvedValue([
      group,
      { album: "Shields", artist: "Grizzly Bear", trackIds: [3] },
    ]);

    await open();

    expect(screen.getByRole("heading", { name: /release 1 of 2/ })).toBeInTheDocument();
  });

  it("says so when MusicBrainz has nothing", async () => {
    vi.mocked(tagsourceSearch).mockResolvedValue([]);
    render(<ReleaseLookup />);

    await useTagsourceStore.getState().open([1, 2]);

    expect(await screen.findByText(/has nothing under that album and artist/)).toBeInTheDocument();
  });
});

describe("the confirm step", () => {
  it("maps each file to the track it is about to be named after", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: /Loveless/ }));

    const rows = await screen.findAllByRole("row");
    // One header row, then one per selected file.
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByText("File 1")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("1. Only Shallow")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("2. Loomer")).toBeInTheDocument();
  });

  /** The reorder controls: the rows stay put, the tracks move between them. */
  it("swaps two files' tracks when a row is moved", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Loveless/ }));
    await screen.findAllByRole("row");

    await user.click(screen.getByRole("button", { name: "Move down: File 1" }));

    const rows = screen.getAllByRole("row");
    expect(within(rows[1] as HTMLElement).getByText("2. Loomer")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("1. Only Shallow")).toBeInTheDocument();
  });

  it("writes only the ticked fields", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Loveless/ }));
    await screen.findAllByRole("row");

    await user.click(screen.getByRole("checkbox", { name: "Year" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(tagsourceApply).toHaveBeenCalled());
    const [edits] = vi.mocked(tagsourceApply).mock.calls[0] ?? [];
    expect(edits?.[0]?.edit.title).toBe("Only Shallow");
    expect(edits?.[0]?.edit.year).toBeNull();
  });

  it("offers no artwork when the archive had none", async () => {
    vi.mocked(tagsourceFetch).mockResolvedValue({ ...detail, coverPath: null });
    const user = await open();

    await user.click(screen.getByRole("button", { name: /Loveless/ }));

    expect(await screen.findByText("No artwork in the archive")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Artwork" })).toBeDisabled();
  });

  it("returns to the results without searching again", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Loveless/ }));
    await screen.findAllByRole("row");

    await user.click(screen.getByRole("button", { name: "Back to Results" }));

    expect(await screen.findByText("98%")).toBeInTheDocument();
    expect(tagsourceSearch).toHaveBeenCalledTimes(1);
  });

  /**
   * The line that says what an apply is about to do outside the selection,
   * which is the one thing about this dialog a person could not guess.
   */
  it("says the identifiers reach the whole release", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: /Loveless/ }));

    expect(
      await screen.findByText(/identifiers are written to every song of this release/),
    ).toBeInTheDocument();
  });
});
