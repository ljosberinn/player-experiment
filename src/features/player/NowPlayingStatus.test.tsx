import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../../ipc";
import { NowPlayingStatus } from "./NowPlayingStatus";
import { usePlayerStore } from "./store";

vi.mock("../../ipc", () => ({ coverUrl: vi.fn() }));

const now = () => Math.floor(Date.now() / 1000);

/** Noon `days` calendar days back, so no daylight-saving change moves the day. */
function daysAgo(days: number): number {
  const today = new Date();
  return Math.floor(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - days, 12).getTime() / 1000,
  );
}

function track(id: number, overrides: Partial<Track> = {}): Track {
  return {
    id,
    path: `/m/${id}.mp3`,
    duration_ms: 200_000,
    title: `Track ${id}`,
    artist: "Artist",
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
    release_mbid: null,
    release_group_mbid: null,
    ...overrides,
  };
}

beforeEach(() => {
  usePlayerStore.setState({ track: null });
});

describe("NowPlayingStatus", () => {
  it("keeps the plays from before this one once this one counts", () => {
    usePlayerStore.setState({ track: track(1, { play_count: 56, last_played_at: daysAgo(3) }) });
    render(<NowPlayingStatus />);
    expect(screen.getByText(/^56 plays/)).toBeInTheDocument();

    // The pause after `mark_played` re-sends the row it wrote.
    act(() =>
      usePlayerStore.setState({ track: track(1, { play_count: 57, last_played_at: now() }) }),
    );

    expect(screen.getByText(/^56 plays/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "last played 3 days ago" })).toBeInTheDocument();
  });

  it("reads the next song afresh", () => {
    usePlayerStore.setState({ track: track(1, { play_count: 56, last_played_at: now() }) });
    render(<NowPlayingStatus />);

    act(() => usePlayerStore.setState({ track: track(2) }));

    expect(screen.getByText("First play")).toBeInTheDocument();
  });
});
