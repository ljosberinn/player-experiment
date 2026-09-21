import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseCandidate, ReleaseDetail, ReleaseSelection, Track } from "../../ipc";
import {
  tagsourceApply,
  tagsourceFetch,
  tagsourceGroups,
  tagsourceReviewQueue,
  tagsourceSearch,
  tagsourceSetAside,
  tracksByIds,
} from "../../ipc";
import { ReleaseLookup } from "./ReleaseLookup";
import { useTagsourceStore } from "./store";

vi.mock("../../ipc", () => ({
  INVALIDATE_DEBOUNCE_MS: 250,
  coverUrl: (hash: string) => `cover-url:${hash}`,
  stagedCoverUrl: (version: string) => `staged-cover-url:${version}`,
  onLibraryChanged: vi.fn(async () => () => {}),
  onTagWriteProgress: vi.fn(async () => () => {}),
  tagsourceGroups: vi.fn(),
  tagsourceSearch: vi.fn(),
  tagsourceFetch: vi.fn(),
  tagsourceApply: vi.fn(),
  tagsourceReviewQueue: vi.fn(),
  tagsourceReviewCounts: vi.fn(),
  tagsourceSetAside: vi.fn(),
  tagsourceRestoreReview: vi.fn(),
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
    release_group_mbid: null,
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
  vi.mocked(tagsourceSetAside).mockResolvedValue(undefined);
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

/** The two rows the review queue opens on, best match first. */
const reviewQueue = [
  { ...group, candidates: [candidate()], score: 0.97 },
  { album: "Spiderland", artist: "Slint", trackIds: [3], candidates: [], score: 0.42 },
];

/** Renders the dialog on the review queue's table. */
async function openTable() {
  vi.mocked(tagsourceReviewQueue).mockResolvedValue(reviewQueue);
  render(<ReleaseLookup />);
  await useTagsourceStore.getState().openReview();
  await screen.findByRole("table");
  return userEvent.setup();
}

describe("the review table", () => {
  it("lists every queued release in the order it arrived", async () => {
    await openTable();

    const rows = screen.getAllByRole("row");
    // The header row, then one per queued release.
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByText("97%")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("loveless")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("42%")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("Spiderland")).toBeInTheDocument();
  });

  /**
   * What says why a release above the bar is in the queue at all: the pass
   * also queues one whose track count disagrees.
   */
  it("counts the files against the candidate the score was measured on", async () => {
    await openTable();

    const rows = screen.getAllByRole("row");
    expect(within(rows[1] as HTMLElement).getByText("2 / 2")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText(/1991 · GB · CD/)).toBeInTheDocument();
    // The second release's cache is gone, so there is nothing to count against.
    expect(within(rows[2] as HTMLElement).getByText("1 / —")).toBeInTheDocument();
  });

  it("marks a release whose track count disagrees", async () => {
    vi.mocked(tagsourceReviewQueue).mockResolvedValue([
      { ...group, candidates: [candidate({ trackCount: 12 })], score: 0.97 },
    ]);
    render(<ReleaseLookup />);
    await useTagsourceStore.getState().openReview();

    const cell = await screen.findByText("2 / 12");
    expect(cell).toHaveClass("disagrees");
  });

  it("opens the release a row is clicked on", async () => {
    const user = await openTable();

    await user.click(within(screen.getAllByRole("row")[2] as HTMLElement).getByText("Spiderland"));

    await waitFor(() => expect(useTagsourceStore.getState().index).toBe(1));
    expect(tracksByIds).toHaveBeenCalledWith([3]);
  });

  it("opens the release a row is entered on", async () => {
    const user = await openTable();

    (screen.getAllByRole("row")[1] as HTMLElement).focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(useTagsourceStore.getState().index).toBe(0));
  });

  /** Both act on a release, and on the table there is not one open. */
  it("offers neither Set Aside nor a skip", async () => {
    await openTable();

    expect(screen.queryByRole("button", { name: "Set Aside" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Skip|Back to Queue/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});

describe("a release out of the review queue", () => {
  /** Opens the dialog on the queue the unattended pass filled, on its first release. */
  async function openReview() {
    const user = await openTable();
    await user.click(within(screen.getAllByRole("row")[1] as HTMLElement).getByText("loveless"));
    await screen.findByRole("button", { name: /Loveless/ });
    return user;
  }

  it("takes the release out of the table and returns there", async () => {
    const user = await openReview();

    await user.click(screen.getByRole("button", { name: "Set Aside" }));

    expect(tagsourceSetAside).toHaveBeenCalledWith("loveless", "MBV");
    await waitFor(() => expect(useTagsourceStore.getState().index).toBeNull());
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  /** A cache with no way to refresh it is a worse answer than a slow one. */
  it("searches again over the cached candidates when asked", async () => {
    const user = await openReview();
    expect(tagsourceSearch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Search again" }));

    expect(tagsourceSearch).toHaveBeenCalledWith("loveless", "MBV");
  });

  /**
   * Back to Queue means "not now" - the entry stays queued and is still in
   * the table - which is what makes Set Aside beside it a different decision
   * rather than a louder one.
   */
  it("does not set a release aside merely for being left", async () => {
    const user = await openReview();

    await user.click(screen.getByRole("button", { name: "Back to Queue" }));

    expect(tagsourceSetAside).not.toHaveBeenCalled();
    await waitFor(() => expect(useTagsourceStore.getState().index).toBeNull());
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  /** The table is where the queue's length is read, not the title. */
  it("does not number a release out of a queue that is picked from", async () => {
    await openReview();

    expect(screen.getByRole("heading", { level: 2 })).not.toHaveTextContent(/release 1 of 2/);
  });

  /** On a selection the queue dies with the dialog, so there is nothing to set aside. */
  it("offers Set Aside on the review queue and nowhere else", async () => {
    await open();

    expect(screen.queryByRole("button", { name: "Set Aside" })).not.toBeInTheDocument();
  });
});

/**
 * The dialog is a fixed box, so the body has to be the only thing that
 * scrolls - a result list that grows by fourteen rows must not take the button
 * under the pointer with it. jsdom lays nothing out, so what is asserted here
 * is the structure the layout rests on.
 */
describe("the fixed box", () => {
  /** The one scroll area, which every state has to put its content inside. */
  function body(): HTMLElement {
    const found = document.querySelector<HTMLElement>(".dialog-body");
    if (found === null) {
      throw new Error("the dialog has no scrolling body");
    }
    return found;
  }

  it("scrolls the results without the heading or the queue actions", async () => {
    await open();

    expect(body()).toContainElement(screen.getByRole("button", { name: /Loveless/ }));
    expect(body()).not.toContainElement(screen.getByRole("heading", { level: 2 }));
    expect(body()).not.toContainElement(screen.getByRole("button", { name: "Skip" }));
    expect(body()).not.toContainElement(screen.getByRole("button", { name: "Cancel" }));
  });

  it("scrolls the tracklist without either row of confirm actions", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: /Loveless/ }));
    await screen.findAllByRole("row");

    expect(body()).toContainElement(screen.getByRole("table"));
    expect(body()).not.toContainElement(screen.getByRole("button", { name: "Apply" }));
    expect(body()).not.toContainElement(screen.getByRole("button", { name: "Back to Results" }));
    expect(body()).not.toContainElement(screen.getByRole("button", { name: "Skip" }));
  });

  /** Four hundred rows, so the table is the state that needs this most. */
  it("scrolls the review table without the heading or Cancel", async () => {
    await openTable();

    expect(body()).toContainElement(screen.getByRole("table"));
    expect(body()).not.toContainElement(screen.getByRole("heading", { level: 2 }));
    expect(body()).not.toContainElement(screen.getByRole("button", { name: "Cancel" }));
  });

  /** An error that can scroll out of sight is no error message. */
  it("keeps a refused search out of the scroller", async () => {
    const user = await open();
    vi.mocked(tagsourceSearch).mockRejectedValue(new Error("MusicBrainz is down"));

    await user.click(screen.getByRole("button", { name: "Search again" }));

    const alert = await screen.findByRole("alert");
    expect(body()).not.toContainElement(alert);
  });
});
