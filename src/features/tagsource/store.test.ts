import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseCandidate, ReleaseDetail, ReleaseSelection, Track } from "../../ipc";
import {
  tagsourceApply,
  tagsourceFetch,
  tagsourceGroups,
  tagsourceReviewCounts,
  tagsourceReviewQueue,
  tagsourceSearch,
  tagsourceSetAside,
  tracksByIds,
} from "../../ipc";
import { useStatusStore } from "../shell/statusStore";
import { useTagsourceStore } from "./store";

vi.mock("../../ipc", () => ({
  INVALIDATE_DEBOUNCE_MS: 250,
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

function group(album: string, artist: string, trackIds: number[]): ReleaseSelection {
  return { album, artist, trackIds };
}

function track(id: number): Track {
  return {
    id,
    path: `/m/${id}.mp3`,
    duration_ms: 200_000,
    title: `File ${id}`,
    artist: null,
    album: null,
    album_artist: null,
    genre: null,
    year: null,
    track_no: null,
    disc_no: null,
    comment: null,
    bitrate: null,
    sample_rate: null,
    cover_hash: null,
    added_at: 0,
    play_count: 0,
    last_played_at: null,
    missing_since: null,
  };
}

const candidate: ReleaseCandidate = {
  mbid: "bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9",
  releaseGroupMbid: "2c7d1b1a-1a1a-4c4c-8f8f-9a9a9a9a9a9a",
  title: "Loveless",
  artist: "My Bloody Valentine",
  date: "1991-11-04",
  country: "GB",
  format: "CD",
  trackCount: 11,
  discCount: 1,
  score: 0.98,
};

const detail: ReleaseDetail = {
  candidate,
  albumArtist: "My Bloody Valentine",
  year: 1991,
  tracks: [
    { title: "Only Shallow", artist: "My Bloody Valentine", trackNo: 1, discNo: 1, durationMs: 1 },
  ],
  genre: null,
  releaseType: null,
  coverPath: null,
};

const initial = useTagsourceStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useTagsourceStore.setState(initial, true);
  useStatusStore.setState(useStatusStore.getState(), true);
  vi.mocked(tracksByIds).mockResolvedValue([track(1), track(2)]);
  vi.mocked(tagsourceSearch).mockResolvedValue([candidate]);
  vi.mocked(tagsourceFetch).mockResolvedValue(detail);
  vi.mocked(tagsourceApply).mockResolvedValue({ written: 2, failed: 0, errors: [] });
  vi.mocked(tagsourceReviewQueue).mockResolvedValue([]);
  vi.mocked(tagsourceReviewCounts).mockResolvedValue({ review: 0, aside: 0 });
  vi.mocked(tagsourceSetAside).mockResolvedValue(undefined);
});

describe("opening", () => {
  it("groups the selection and searches for the first release", async () => {
    vi.mocked(tagsourceGroups).mockResolvedValue([
      group("Loveless", "My Bloody Valentine", [1, 2]),
      group("Shields", "Grizzly Bear", [3]),
    ]);

    await useTagsourceStore.getState().open([1, 2, 3]);

    expect(useTagsourceStore.getState().queue).toHaveLength(2);
    expect(useTagsourceStore.getState().index).toBe(0);
    expect(useTagsourceStore.getState().stage).toBe("results");
    // One search, for one release - not one per track.
    expect(tagsourceSearch).toHaveBeenCalledTimes(1);
    expect(tagsourceSearch).toHaveBeenCalledWith("Loveless", "My Bloody Valentine");
  });

  it("does nothing when the selection is empty", async () => {
    await useTagsourceStore.getState().open([]);

    expect(tagsourceGroups).not.toHaveBeenCalled();
    expect(useTagsourceStore.getState().queue).toBeNull();
  });

  it("reads the selected rows fresh rather than trusting a cache", async () => {
    vi.mocked(tagsourceGroups).mockResolvedValue([
      group("Loveless", "My Bloody Valentine", [1, 2]),
    ]);

    await useTagsourceStore.getState().open([1, 2]);

    expect(tracksByIds).toHaveBeenCalledWith([1, 2]);
    expect(useTagsourceStore.getState().tracks).toHaveLength(2);
  });
});

describe("the queue", () => {
  beforeEach(async () => {
    vi.mocked(tagsourceGroups).mockResolvedValue([
      group("Loveless", "My Bloody Valentine", [1, 2]),
      group("Shields", "Grizzly Bear", [3]),
    ]);
    await useTagsourceStore.getState().open([1, 2, 3]);
  });

  it("moves to the next release on a skip", async () => {
    await useTagsourceStore.getState().skip();

    expect(useTagsourceStore.getState().index).toBe(1);
    expect(tagsourceSearch).toHaveBeenLastCalledWith("Shields", "Grizzly Bear");
  });

  it("closes once the last release is past", async () => {
    await useTagsourceStore.getState().skip();
    await useTagsourceStore.getState().skip();

    expect(useTagsourceStore.getState().queue).toBeNull();
  });

  it("goes on to the next release after an apply", async () => {
    await useTagsourceStore.getState().pick(candidate.mbid);
    await useTagsourceStore.getState().apply([]);

    expect(tagsourceApply).toHaveBeenCalledTimes(1);
    expect(useTagsourceStore.getState().index).toBe(1);
    expect(useStatusStore.getState().notice).toContain("2 songs");
  });

  /**
   * The identity is what the apply is for, and it is keyed by what the library
   * calls the release rather than by what MusicBrainz does.
   */
  it("sends the local album and artist with the release it was matched to", async () => {
    await useTagsourceStore.getState().pick(candidate.mbid);
    await useTagsourceStore.getState().apply([]);

    expect(tagsourceApply).toHaveBeenCalledWith([], {
      album: "Loveless",
      artist: "My Bloody Valentine",
      releaseMbid: candidate.mbid,
      releaseGroupMbid: candidate.releaseGroupMbid,
    });
  });
});

describe("failures", () => {
  beforeEach(() => {
    vi.mocked(tagsourceGroups).mockResolvedValue([
      group("Loveless", "My Bloody Valentine", [1, 2]),
    ]);
  });

  it("shows a failed search on the release it failed for, without closing", async () => {
    vi.mocked(tagsourceSearch).mockRejectedValue("could not reach musicbrainz.org");

    await useTagsourceStore.getState().open([1, 2]);

    expect(useTagsourceStore.getState().queue).toHaveLength(1);
    expect(useTagsourceStore.getState().stage).toBe("results");
    expect(useTagsourceStore.getState().error).toContain("musicbrainz.org");
  });

  it("returns to the results when a tracklist cannot be read", async () => {
    vi.mocked(tagsourceFetch).mockRejectedValue("MusicBrainz has no release");
    await useTagsourceStore.getState().open([1, 2]);

    await useTagsourceStore.getState().pick(candidate.mbid);

    expect(useTagsourceStore.getState().stage).toBe("results");
    expect(useTagsourceStore.getState().detail).toBeNull();
  });

  /** A refused write leaves the mapping on screen so it can be corrected. */
  it("stays on the confirm step when the write is refused", async () => {
    vi.mocked(tagsourceApply).mockRejectedValue("a file is read-only");
    await useTagsourceStore.getState().open([1, 2]);
    await useTagsourceStore.getState().pick(candidate.mbid);

    await useTagsourceStore.getState().apply([]);

    expect(useTagsourceStore.getState().stage).toBe("confirm");
    expect(useTagsourceStore.getState().detail).not.toBeNull();
    expect(useTagsourceStore.getState().error).toContain("read-only");
    expect(useTagsourceStore.getState().progress).toBeNull();
  });

  it("says so when a write only partly succeeded", async () => {
    vi.mocked(tagsourceApply).mockResolvedValue({
      written: 1,
      failed: 1,
      errors: ["/m/2.mp3: access denied"],
    });
    await useTagsourceStore.getState().open([1, 2]);
    await useTagsourceStore.getState().pick(candidate.mbid);

    await useTagsourceStore.getState().apply([]);

    expect(useStatusStore.getState().notice).toContain("access denied");
  });
});

describe("going back", () => {
  it("returns to the results without fetching again", async () => {
    vi.mocked(tagsourceGroups).mockResolvedValue([
      group("Loveless", "My Bloody Valentine", [1, 2]),
    ]);
    await useTagsourceStore.getState().open([1, 2]);
    await useTagsourceStore.getState().pick(candidate.mbid);

    useTagsourceStore.getState().back();

    expect(useTagsourceStore.getState().stage).toBe("results");
    expect(useTagsourceStore.getState().candidates).toHaveLength(1);
    expect(tagsourceSearch).toHaveBeenCalledTimes(1);
  });
});

describe("the review queue", () => {
  /**
   * The point of caching the candidates. Searching again at review time is a
   * rate-limited ten seconds an entry, and four hundred entries is over an
   * hour of waiting to click.
   */
  it("opens on the candidates the pass already found, without searching", async () => {
    vi.mocked(tagsourceReviewQueue).mockResolvedValue([
      {
        album: "Loveless",
        artist: "My Bloody Valentine",
        trackIds: [1, 2],
        candidates: [candidate],
      },
    ]);

    await useTagsourceStore.getState().openReview();

    expect(useTagsourceStore.getState().stage).toBe("results");
    expect(useTagsourceStore.getState().candidates).toEqual([candidate]);
    expect(tagsourceSearch).not.toHaveBeenCalled();
  });

  /** A cache with no way to refresh it is a worse answer than a slow one. */
  it("searches again when asked, over the cache it opened on", async () => {
    vi.mocked(tagsourceReviewQueue).mockResolvedValue([
      { album: "Loveless", artist: "My Bloody Valentine", trackIds: [1, 2], candidates: [] },
    ]);
    await useTagsourceStore.getState().openReview();

    await useTagsourceStore.getState().search();

    expect(tagsourceSearch).toHaveBeenCalledWith("Loveless", "My Bloody Valentine");
    expect(useTagsourceStore.getState().candidates).toEqual([candidate]);
  });

  it("still reads the files of a release whose candidates were cached", async () => {
    vi.mocked(tagsourceReviewQueue).mockResolvedValue([
      {
        album: "Loveless",
        artist: "My Bloody Valentine",
        trackIds: [1, 2],
        candidates: [candidate],
      },
    ]);

    await useTagsourceStore.getState().openReview();

    expect(tracksByIds).toHaveBeenCalledWith([1, 2]);
    expect(useTagsourceStore.getState().tracks).toHaveLength(2);
  });

  /**
   * Opening the queue prunes rows whose release has since been retagged, so
   * what comes back is a better answer than the count the row was drawn with.
   */
  it("trusts the queue it read over the count it was showing", async () => {
    useTagsourceStore.setState({ review: 9 });
    vi.mocked(tagsourceReviewQueue).mockResolvedValue([]);

    await useTagsourceStore.getState().openReview();

    expect(useTagsourceStore.getState().review).toBe(0);
    expect(useTagsourceStore.getState().queue).toBeNull();
  });

  it("sets a release aside and moves to the next", async () => {
    vi.mocked(tagsourceReviewQueue).mockResolvedValue([
      { album: "Loveless", artist: "My Bloody Valentine", trackIds: [1], candidates: [] },
      { album: "Spiderland", artist: "Slint", trackIds: [2], candidates: [] },
    ]);
    await useTagsourceStore.getState().openReview();

    await useTagsourceStore.getState().setAside();

    expect(tagsourceSetAside).toHaveBeenCalledWith("Loveless", "My Bloody Valentine");
    expect(useTagsourceStore.getState().index).toBe(1);
  });

  /** Moving on would look like the release had been set aside. */
  it("stays where it is when setting aside fails", async () => {
    vi.mocked(tagsourceSetAside).mockRejectedValue("the database is locked");
    vi.mocked(tagsourceReviewQueue).mockResolvedValue([
      { album: "Loveless", artist: "My Bloody Valentine", trackIds: [1], candidates: [] },
      { album: "Spiderland", artist: "Slint", trackIds: [2], candidates: [] },
    ]);
    await useTagsourceStore.getState().openReview();

    await useTagsourceStore.getState().setAside();

    expect(useTagsourceStore.getState().index).toBe(0);
    expect(useTagsourceStore.getState().error).toContain("locked");
  });

  /** Set Aside is offered on the persistent queue and nowhere else. */
  it("is the only queue a release can be set aside from", async () => {
    vi.mocked(tagsourceGroups).mockResolvedValue([
      group("Loveless", "My Bloody Valentine", [1, 2]),
    ]);

    await useTagsourceStore.getState().open([1, 2]);

    expect(useTagsourceStore.getState().fromReview).toBe(false);
  });
});
