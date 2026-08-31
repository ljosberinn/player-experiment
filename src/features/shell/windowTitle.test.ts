import { describe, expect, it } from "vitest";
import type { Track } from "../../ipc";
import { windowTitle } from "./windowTitle";

function track(over: Partial<Track> = {}): Track {
  return {
    id: 1,
    path: "D:/Music/Guitar/Tokyo/01 Maki.mp3",
    duration_ms: 208_000,
    title: "Maki",
    artist: "Guitar",
    album: "Tokyo",
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
    ...over,
  };
}

describe("windowTitle", () => {
  it("is the product name alone when nothing is playing", () => {
    expect(windowTitle(null)).toBe("Apex");
  });

  it("names the song and its artist after the product", () => {
    expect(windowTitle(track())).toBe("Apex — Maki — Guitar");
  });

  it("falls back to the file name for a track with no title", () => {
    expect(windowTitle(track({ title: null }))).toBe("Apex — 01 Maki.mp3 — Guitar");
  });

  it("drops the artist rather than trailing a dash with nothing after it", () => {
    expect(windowTitle(track({ artist: null }))).toBe("Apex — Maki");
    expect(windowTitle(track({ artist: "  " }))).toBe("Apex — Maki");
  });
});
