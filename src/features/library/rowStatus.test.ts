import { describe, expect, it } from "vitest";
import type { Track } from "../../ipc";
import { rowStatus } from "./rowStatus";

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    path: "D:/Music/Guitar/Tokyo/01 Maki.mp3",
    duration_ms: 208_000,
    title: "Maki",
    artist: "Guitar",
    album: "Tokyo",
    album_artist: "Guitar",
    genre: "Shoegaze",
    year: 2012,
    track_no: 1,
    disc_no: null,
    comment: null,
    bitrate: null,
    sample_rate: null,
    cover_hash: null,
    added_at: 0,
    play_count: 0,
    last_played_at: null,
    missing_since: null,
    ...overrides,
  };
}

describe("what a row has to say about itself", () => {
  it("says nothing about an ordinary track", () => {
    // The overwhelmingly common case: one cell in the whole table is not empty.
    expect(rowStatus(track(), false)).toBeNull();
  });

  it("marks the track that is playing", () => {
    expect(rowStatus(track({ id: 7 }), true)).toBe("playing");
  });

  it("marks a track whose file is gone", () => {
    expect(rowStatus(track({ missing_since: 1_700_000_000 }), false)).toBe("missing");
  });

  it("prefers playing over a stale missing mark", () => {
    // A track marked by a failed load whose file has since come back is
    // playing now; the mark is stale until the next scan clears it. What the
    // row is doing beats what a scan last thought.
    expect(rowStatus(track({ id: 7, missing_since: 1_700_000_000 }), true)).toBe("playing");
  });

  it("treats a zero timestamp as missing rather than as absent", () => {
    // `missing_since` is a time, and 0 is a time. Testing it for truthiness
    // rather than for null would read the epoch as "present".
    expect(rowStatus(track({ missing_since: 0 }), false)).toBe("missing");
  });
});
