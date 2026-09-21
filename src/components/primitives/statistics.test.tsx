import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { StatRow } from "./StatRow";
import { StatTiles } from "./StatTiles";

/**
 * What jsdom can actually see.
 *
 * Section 4a is two drawings of one idea, so the two components share this
 * file: the row is the bare figures, the tiles are the ones that need a line
 * of prose under them. Both are drawn in `library.css`, which is not applied
 * here - everything below is about the markup a caller would otherwise have
 * to get right by hand.
 */
describe("StatRow", () => {
  test("states the whole row as one list rather than one list per figure", () => {
    // Four separate `<dl>`s are four unrelated groups, so "Plays 237,675" and
    // "Artists 9,476" read out with nothing saying they are one row of one
    // subject. One list around the set is what makes them a set.
    const { container } = render(
      <StatRow
        figures={[
          { label: "Plays", value: "237,675" },
          { label: "Artists", value: "9,476" },
          { label: "Albums", value: "4,102" },
          { label: "Tracks", value: "49,570" },
        ]}
      />,
    );

    expect(container.querySelectorAll("dl")).toHaveLength(1);
    expect(container.querySelectorAll("dt")).toHaveLength(4);
  });

  test("reads each figure as its label followed by its value", () => {
    render(<StatRow figures={[{ label: "Plays", value: "237,675" }]} />);

    const term = screen.getByText("Plays");
    expect(term.tagName).toBe("DT");
    expect(term.nextElementSibling).toHaveTextContent("237,675");
  });

  test("keeps a unit inside the figure it rides on", () => {
    // "1.5" and "yrs" are one answer drawn at two sizes, not a figure and a
    // caption - split into two definitions it reads as two.
    const { container } = render(
      <StatRow figures={[{ label: "Time spent", value: "1.5", unit: "yrs" }]} />,
    );

    expect(container.querySelectorAll("dd")).toHaveLength(1);
    expect(screen.getByText("Time spent").nextElementSibling).toHaveTextContent("1.5 yrs");
  });
});

describe("StatTiles", () => {
  test("states the whole grid as one list rather than one list per tile", () => {
    const { container } = render(
      <StatTiles
        tiles={[
          { label: "Listening days", value: "4,738", caption: "since 14/09/2011" },
          { label: "Time spent", value: "1.5 yrs" },
          { label: "Owned", value: "68%", caption: "plays matched to a file" },
        ]}
      />,
    );

    expect(container.querySelectorAll("dl")).toHaveLength(1);
    expect(container.querySelectorAll("dt")).toHaveLength(3);
  });

  test("leaves out the caption line when there is none", () => {
    // An empty element in its place still takes the line's height, so a row
    // of cells would be ragged along the bottom.
    const { container } = render(<StatTiles tiles={[{ label: "Songs", value: "49,570" }]} />);

    expect(container.querySelectorAll("dd")).toHaveLength(1);
  });

  test("hangs the caption off the same label as the figure", () => {
    // "plays matched to a file" is about the 68% above it, so it is a second
    // definition of the same term rather than a tile of its own.
    render(
      <StatTiles tiles={[{ label: "Owned", value: "68%", caption: "plays matched to a file" }]} />,
    );

    expect(screen.getByText("plays matched to a file").tagName).toBe("DD");
  });

  test("keeps a unit inside the figure it rides on", () => {
    // The sheet rides the per-cent sign on the figure at a smaller size. Two
    // definitions would read as two answers, and the caption line below is
    // already spoken for.
    const { container } = render(
      <StatTiles tiles={[{ label: "Owned", value: "68", unit: "%" }]} />,
    );

    expect(container.querySelectorAll("dd")).toHaveLength(1);
    expect(screen.getByText("Owned").nextElementSibling).toHaveTextContent("68%");
  });

  test("marks a delta apart from an ordinary caption", () => {
    // The sheet draws "+18% on last month" in the accent and "since
    // 14.9.2011" in muted. The tile is where that is decided, because a
    // caller passing a colour would be passing a colour.
    render(
      <StatTiles
        tiles={[
          { label: "This month", value: "1,204", caption: "+18% on last month", delta: true },
          { label: "Owned", value: "68%", caption: "plays matched to a file" },
        ]}
      />,
    );

    expect(screen.getByText("+18% on last month")).toHaveClass("delta");
    expect(screen.getByText("plays matched to a file")).not.toHaveClass("delta");
  });
});
