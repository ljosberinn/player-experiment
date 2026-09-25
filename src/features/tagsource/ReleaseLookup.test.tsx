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

/** Opens the dialog on a selection of one release and waits for its results. */
async function open() {
  render(<ReleaseLookup />);
  await useTagsourceStore.getState().open([1, 2]);
  await screen.findByRole("button", { name: /Loveless/ });
  return userEvent.setup();
}

/** The mapping table's rows, without its header row. */
function mapRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1);
}

describe("the pane", () => {
  it("draws nothing until a lookup is open", () => {
    render(<ReleaseLookup />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names the release it is on and what it found", async () => {
    await open();

    expect(screen.getByText(/— MBV · 2 files/)).toBeInTheDocument();
    // The score the list is sorted by, beside the result rather than implied.
    expect(screen.getByText("98%")).toBeInTheDocument();
    expect(screen.getByText(/1991 · GB · CD · 2 tracks/)).toBeInTheDocument();
  });

  /** The queue's own length, which is the column beside the pane. */
  it("counts the releases beside the title", async () => {
    vi.mocked(tagsourceGroups).mockResolvedValue([
      group,
      { album: "Shields", artist: "Grizzly Bear", trackIds: [3] },
    ]);

    await open();

    expect(screen.getByText("2 releases")).toBeInTheDocument();
  });

  it("says so when MusicBrainz has nothing", async () => {
    vi.mocked(tagsourceSearch).mockResolvedValue([]);
    render(<ReleaseLookup />);

    await useTagsourceStore.getState().open([1, 2]);

    expect(await screen.findByText(/has nothing under that album and artist/)).toBeInTheDocument();
  });

  /** The files alone are a list with nothing to compare them against. */
  it("draws no mapping before a tracklist", async () => {
    await open();

    expect(screen.queryByRole("table")).toBeNull();
  });

  it("numbers the files the way it numbers the tracks", async () => {
    vi.mocked(tracksByIds).mockResolvedValue([
      track(1, { disc_no: 1, track_no: 3 }),
      track(2, { disc_no: 2, track_no: 1 }),
      track(3, { disc_no: null, track_no: null }),
    ]);
    const user = await open();

    await user.click(screen.getByRole("button", { name: /Loveless/ }));

    await screen.findByRole("table");
    const rows = mapRows();
    expect(within(rows[0] as HTMLElement).getByText("1-3. File 1")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("2-1. File 2")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("— File 3")).toBeInTheDocument();
  });

  it("counts both sides of the mapping in its heads", async () => {
    vi.mocked(tracksByIds).mockResolvedValue([track(1), track(2), track(3)]);
    const user = await open();

    await user.click(screen.getByRole("button", { name: /Loveless/ }));

    expect(
      await screen.findByRole("columnheader", { name: "MusicBrainz · 2" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "File · 3" })).toBeInTheDocument();
  });

  /** No spinner: the rail and the line say which step is outstanding. */
  it("says what it is waiting for", async () => {
    let settle: (found: ReleaseCandidate[]) => void = () => {};
    vi.mocked(tagsourceSearch).mockReturnValue(
      new Promise<ReleaseCandidate[]>((resolve) => {
        settle = resolve;
      }),
    );
    render(<ReleaseLookup />);
    void useTagsourceStore.getState().open([1, 2]);

    expect(await screen.findByText("Searching MusicBrainz…")).toBeInTheDocument();

    settle([candidate()]);
    await screen.findByRole("button", { name: /Loveless/ });
  });
});

describe("the confirm step", () => {
  it("maps each file to the track it is about to be named after", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: /Loveless/ }));

    await screen.findByText("1. Only Shallow");
    const rows = mapRows();
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("1. File 1")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("1. Only Shallow")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("2. Loomer")).toBeInTheDocument();
  });

  it("counts what a release would map before it is applied", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: /Loveless/ }));

    expect(await screen.findByText(/— MBV · 2 of 2 files mapped/)).toBeInTheDocument();
  });

  /** The reorder controls: the rows stay put, the tracks move between them. */
  it("swaps two files' tracks when a row is moved", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Loveless/ }));
    await screen.findByText("1. Only Shallow");

    await user.click(screen.getByRole("button", { name: "Move down: File 1" }));

    const rows = mapRows();
    expect(within(rows[0] as HTMLElement).getByText("2. Loomer")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("1. Only Shallow")).toBeInTheDocument();
  });

  /** The rows worth reading open; a file already tagged as its track folded away. */
  it("folds away the files an apply would leave as they are", async () => {
    vi.mocked(tracksByIds).mockResolvedValue([
      track(1, { title: "Only Shallow", artist: "My Bloody Valentine" }),
      track(2),
    ]);
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Loveless/ }));
    const [changed] = await screen.findAllByRole("table");
    expect(within(changed as HTMLElement).getAllByRole("row")).toHaveLength(2);
    expect(within(changed as HTMLElement).getByText("2. File 2")).toBeInTheDocument();
    // Nothing above or below it within its own group.
    expect(screen.getByRole("button", { name: "Move down: File 2" })).toBeDisabled();

    const fold = screen.getByText("Unchanged · 1").closest("details");
    expect(fold).not.toHaveAttribute("open");

    await user.click(screen.getByText("Unchanged · 1"));

    expect(fold).toHaveAttribute("open");
    const unchanged = screen.getByRole("table", { name: "Unchanged" });
    expect(within(unchanged).getAllByText("1. Only Shallow")).toHaveLength(2);
  });

  it("regroups a row once its only difference is not being written", async () => {
    vi.mocked(tracksByIds).mockResolvedValue([
      track(1, { title: "only shallow", artist: "My Bloody Valentine" }),
      track(2),
    ]);
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Loveless/ }));
    await screen.findByText("1. Only Shallow");
    expect(screen.queryByText(/Unchanged/)).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Title" }));

    expect(screen.getByText("Unchanged · 1")).toBeInTheDocument();
  });

  it("writes only the ticked fields", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Loveless/ }));
    await screen.findByText("1. Only Shallow");

    await user.click(screen.getByRole("checkbox", { name: "Year" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(tagsourceApply).toHaveBeenCalled());
    const [edits] = vi.mocked(tagsourceApply).mock.calls[0] ?? [];
    expect(edits?.[0]?.edit.title).toBe("Only Shallow");
    expect(edits?.[0]?.edit.year).toBeNull();
  });

  /** Apply is in the footer now, so it has to say when there is nothing to do. */
  it("cannot be applied before a release is picked", async () => {
    await open();

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("offers no artwork when the archive had none", async () => {
    vi.mocked(tagsourceFetch).mockResolvedValue({ ...detail, coverPath: null });
    const user = await open();

    await user.click(screen.getByRole("button", { name: /Loveless/ }));

    expect(await screen.findByText("No artwork in the archive")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Artwork" })).toBeDisabled();
  });

  /**
   * The footer's left slot holds one step back at a time: out of a picked
   * candidate while there is one, out of a stale list when there is not.
   */
  it("returns to the results without searching again", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Loveless/ }));
    await screen.findByText("1. Only Shallow");
    expect(screen.queryByRole("button", { name: "Search again" })).not.toBeInTheDocument();

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

/** Renders the dialog on the review queue, which opens on its first release. */
async function openReview() {
  vi.mocked(tagsourceReviewQueue).mockResolvedValue(reviewQueue);
  render(<ReleaseLookup />);
  await useTagsourceStore.getState().openReview();
  await screen.findByRole("listbox");
  return userEvent.setup();
}

describe("the queue column", () => {
  it("lists every queued release in the order it arrived", async () => {
    await openReview();

    const rows = screen.getAllByRole("option");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("97%")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("loveless")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("42%")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("Spiderland")).toBeInTheDocument();
  });

  it("opens on the first release rather than on nothing", async () => {
    await openReview();

    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/— MBV · 2 files/)).toBeInTheDocument();
  });

  /**
   * 212px has no column for a track count, and the disagreement is why a
   * release at 97% is in this queue at all - so it colours the score.
   */
  it("marks a release whose track count disagrees", async () => {
    vi.mocked(tagsourceReviewQueue).mockResolvedValue([
      { ...group, candidates: [candidate({ trackCount: 12 })], score: 0.97 },
    ]);
    render(<ReleaseLookup />);
    await useTagsourceStore.getState().openReview();

    expect(await screen.findByText("97%")).toHaveClass("disagrees");
  });

  it("leaves the score plain when the candidate has as many tracks", async () => {
    await openReview();

    expect(screen.getByText("97%")).not.toHaveClass("disagrees");
  });

  it("opens the release a row is clicked on", async () => {
    const user = await openReview();

    await user.click(screen.getByText("Spiderland"));

    await waitFor(() => expect(useTagsourceStore.getState().index).toBe(1));
    expect(tracksByIds).toHaveBeenLastCalledWith([3]);
  });

  /** Selecting costs no request, which is what lets the arrows drive it. */
  it("moves the selection on the arrows", async () => {
    const user = await openReview();
    (screen.getAllByRole("option")[0] as HTMLElement).focus();

    await user.keyboard("{ArrowDown}");

    await waitFor(() => expect(useTagsourceStore.getState().index).toBe(1));
    expect(tagsourceFetch).not.toHaveBeenCalled();
  });

  it("stops at the end of the queue", async () => {
    const user = await openReview();
    (screen.getAllByRole("option")[0] as HTMLElement).focus();

    await user.keyboard("{ArrowUp}");

    expect(useTagsourceStore.getState().index).toBe(0);
  });
});

describe("a release out of the review queue", () => {
  it("takes the release out of the queue and selects nothing", async () => {
    const user = await openReview();

    await user.click(screen.getByRole("button", { name: "Set Aside" }));

    expect(tagsourceSetAside).toHaveBeenCalledWith("loveless", "MBV");
    await waitFor(() => expect(useTagsourceStore.getState().index).toBeNull());
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("Pick a release from the queue.")).toBeInTheDocument();
  });

  /** A cache with no way to refresh it is a worse answer than a slow one. */
  it("searches again over the cached candidates when asked", async () => {
    const user = await openReview();
    expect(tagsourceSearch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Search again" }));

    expect(tagsourceSearch).toHaveBeenCalledWith("loveless", "MBV");
  });

  /** On a selection the queue dies with the dialog, so there is nothing to set aside. */
  it("offers Set Aside on the review queue and nowhere else", async () => {
    await open();

    expect(screen.queryByRole("button", { name: "Set Aside" })).not.toBeInTheDocument();
  });
});

/**
 * The dialog is a fixed box, and 118 gave the scroll to its two columns: a
 * queue of four hundred and a pane that grows with the release. jsdom lays
 * nothing out, so what is asserted here is the structure the layout rests on.
 */
describe("the fixed box", () => {
  /** The grid that holds the two columns, which is not itself a scroller. */
  function body(): HTMLElement {
    const found = document.querySelector<HTMLElement>(".dialog-body");
    if (found === null) {
      throw new Error("the dialog has no body");
    }
    return found;
  }

  function column(selector: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(selector);
    if (found === null) {
      throw new Error(`the dialog has no ${selector}`);
    }
    return found;
  }

  it("keeps the header and every action out of both columns", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Loveless/ }));
    await screen.findByText("1. Only Shallow");

    expect(column(".lookup-pane")).toContainElement(screen.getByRole("table"));
    for (const name of ["Apply", "Cancel", "Back to Results"]) {
      expect(body()).not.toContainElement(screen.getByRole("button", { name }));
    }
    expect(body()).not.toContainElement(screen.getByRole("heading", { level: 2 }));
  });

  /** Four hundred rows, so the queue scrolls without moving the pane. */
  it("scrolls the queue inside its own column", async () => {
    await openReview();
    const first = screen.getAllByRole("option")[0] as HTMLElement;

    expect(column(".lookup-queue-list")).toContainElement(first);
    expect(column(".lookup-pane")).not.toContainElement(first);
  });

  /** An error that can scroll out of sight inside a column is no error message. */
  it("keeps a refused search out of both columns", async () => {
    const user = await open();
    vi.mocked(tagsourceSearch).mockRejectedValue(new Error("MusicBrainz is down"));

    await user.click(screen.getByRole("button", { name: "Search again" }));

    const alert = await screen.findByRole("alert");
    expect(body()).not.toContainElement(alert);
  });
});
