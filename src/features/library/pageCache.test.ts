import { describe, expect, it } from "vitest";
import type { Track } from "../../ipc";
import {
  CACHE_RADIUS_PAGES,
  evictFarPages,
  missingPages,
  PAGE_SIZE,
  type PageState,
  pageIndexOf,
  pagesForRange,
  rowAt,
} from "./pageCache";

function track(id: number): Track {
  return {
    id,
    path: `/m/${id}.mp3`,
    duration_ms: 1000,
    title: `Track ${id}`,
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
  };
}

function page(pageIndex: number): Track[] {
  return Array.from({ length: PAGE_SIZE }, (_, i) => track(pageIndex * PAGE_SIZE + i));
}

describe("page maths", () => {
  it("maps row indices onto pages", () => {
    expect(pageIndexOf(0)).toBe(0);
    expect(pageIndexOf(PAGE_SIZE - 1)).toBe(0);
    expect(pageIndexOf(PAGE_SIZE)).toBe(1);
  });

  it("covers every page a viewport spans", () => {
    expect(pagesForRange(0, 10)).toEqual([0]);
    expect(pagesForRange(PAGE_SIZE - 1, PAGE_SIZE)).toEqual([0, 1]);
    expect(pagesForRange(0, PAGE_SIZE * 2)).toEqual([0, 1, 2]);
  });

  it("returns nothing for an inverted range", () => {
    expect(pagesForRange(10, 5)).toEqual([]);
  });
});

describe("missingPages", () => {
  it("skips pages already cached or already being fetched", () => {
    const cached: PageState = new Map([[0, page(0)]]);
    const inFlight = new Set([1]);

    expect(missingPages([0, 1, 2], cached, inFlight)).toEqual([2]);
  });

  it("never asks for the same page twice while one request is open", () => {
    const inFlight = new Set([3]);

    expect(missingPages([3], new Map(), inFlight)).toEqual([]);
  });
});

describe("rowAt", () => {
  it("returns the row when its page is present", () => {
    const cached: PageState = new Map([[1, page(1)]]);

    expect(rowAt(cached, PAGE_SIZE)?.id).toBe(PAGE_SIZE);
    expect(rowAt(cached, PAGE_SIZE + 5)?.id).toBe(PAGE_SIZE + 5);
  });

  it("returns null for a row whose page has not arrived, so the table can render a placeholder", () => {
    expect(rowAt(new Map(), 42)).toBeNull();
  });
});

describe("evictFarPages", () => {
  it("keeps pages near the viewport and drops the rest", () => {
    const cached: PageState = new Map();
    for (let p = 0; p <= 40; p++) {
      cached.set(p, page(p));
    }

    const kept = evictFarPages(cached, [20, 21]);

    expect(kept.has(20)).toBe(true);
    expect(kept.has(20 - CACHE_RADIUS_PAGES)).toBe(true);
    expect(kept.has(21 + CACHE_RADIUS_PAGES)).toBe(true);
    expect(kept.has(0)).toBe(false);
    expect(kept.has(40)).toBe(false);
  });

  it("keeps memory flat while scrolling through a large library", () => {
    let cached: PageState = new Map();
    // 50k rows at PAGE_SIZE per page, visiting every page in turn.
    for (let p = 0; p < 250; p++) {
      cached.set(p, page(p));
      cached = evictFarPages(cached, [p]);
    }

    expect(cached.size).toBeLessThanOrEqual(CACHE_RADIUS_PAGES * 2 + 1);
  });

  it("leaves the cache alone when nothing is visible", () => {
    const cached: PageState = new Map([[0, page(0)]]);

    expect(evictFarPages(cached, [])).toBe(cached);
  });
});
