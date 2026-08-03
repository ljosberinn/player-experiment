import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Track } from "../../ipc";
import { RowStatusCell } from "./RowStatusCell";

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
    ...overrides,
    missing_since: overrides.missing_since ?? null,
  };
}

/** The cell only makes sense inside the row markup it belongs to. */
function renderCell(value: Track | null, nowPlayingId: number | null = null) {
  return render(
    <table>
      <tbody>
        <tr>
          <RowStatusCell track={value} nowPlayingId={nowPlayingId} />
        </tr>
      </tbody>
    </table>,
  );
}

describe("the row status cell", () => {
  it("is empty for an ordinary track", () => {
    const { container } = renderCell(track());

    // Not "-" or a placeholder glyph: an empty cell in tens of thousands of
    // rows is what makes the marked one visible at all.
    expect(container.querySelector(".row-status")).toBeNull();
    expect(screen.getByRole("cell")).toHaveTextContent("");
  });

  it("is empty for a row whose page has not arrived", () => {
    // Placeholder rows have no track to describe, and a status guessed from
    // nothing would flicker as pages land.
    const { container } = renderCell(null);

    expect(container.querySelector(".row-status")).toBeNull();
  });

  it("names the playing state for a screen reader, not just in colour", () => {
    renderCell(track({ id: 7 }), 7);

    // An icon is not a label. The speaker itself is aria-hidden, so this text
    // is the only thing that says what the cell means.
    expect(screen.getByText("Playing")).toBeInTheDocument();
  });

  it("names the missing state and says which file it is", () => {
    const { container } = renderCell(track({ missing_since: 1_700_000_000 }));

    expect(screen.getByText("File missing")).toBeInTheDocument();
    // "Why is this one marked" is the immediate question, and the answer is
    // the path - which the Location column may well be hidden.
    expect(container.querySelector(".row-status.missing")).toHaveAttribute(
      "title",
      "D:/Music/Guitar/Tokyo/01 Maki.mp3",
    );
  });

  it("carries the missing state in a glyph as well as in red", () => {
    const { container } = renderCell(track({ missing_since: 1 }));

    // Red alone says nothing to anyone who cannot distinguish it.
    expect(container.querySelector(".row-status.missing")).toHaveTextContent("!");
  });

  it("shows the playing marker on a track that is also marked missing", () => {
    renderCell(track({ id: 7, missing_since: 1 }), 7);

    expect(screen.getByText("Playing")).toBeInTheDocument();
    expect(screen.queryByText("File missing")).not.toBeInTheDocument();
  });
});
