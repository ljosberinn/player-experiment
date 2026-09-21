import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { StatRow } from "./StatRow";
import { StatTiles } from "./StatTiles";
import { Streak } from "./Streak";

/**
 * What jsdom can actually see.
 *
 * The Statistics view's own primitives share this file. Section 4a is two
 * drawings of one idea - the row is the bare figures, the tiles are the ones
 * that need a line of prose under them - and 4c is the streak panel, which
 * puts the same kind of figure over a picture of its own. All of them are
 * drawn in `library.css`, which is not applied here: everything below is
 * about the markup a caller would otherwise have to get right by hand.
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

/** Three days, then a gap, then the two the current run is made of. */
const WEEK = [true, true, true, false, false, true, true];

const days = (count: number) => `${count.toLocaleString()} ${count === 1 ? "day" : "days"}`;

describe("Streak", () => {
  test("states the two figures as one list rather than one list per figure", () => {
    // `StatRow`'s rule, for its reason: two `<dl>`s are two unrelated groups,
    // and Current and Longest are one subject measured twice.
    const { container } = render(<Streak current={2} longest={198} days={WEEK} format={days} />);

    expect(container.querySelectorAll("dl")).toHaveLength(1);
    expect(container.querySelectorAll("dt")).toHaveLength(2);
  });

  test("hangs the record's span off the same term as the figure it qualifies", () => {
    render(
      <Streak current={2} longest={198} span="2.1.2012 – 17.7.2012" days={WEEK} format={days} />,
    );

    const span = screen.getByText("2.1.2012 – 17.7.2012");
    expect(span.tagName).toBe("DD");
    expect(span.previousElementSibling).toHaveTextContent("198 days");
  });

  test("leaves the span out when the record has no bounds", () => {
    // An empty element in its place still takes the line's height, which
    // would drop everything under it by a line for no answer.
    const { container } = render(<Streak current={0} longest={0} days={WEEK} format={days} />);

    expect(container.querySelectorAll("dd")).toHaveLength(2);
  });

  test("draws seven days whatever it was given", () => {
    // The strip is a fixed week rather than a series, so an answer that has
    // not landed is seven empty days and not a row that grows into place.
    const { container } = render(
      <Streak current={undefined} longest={undefined} days={[]} format={days} />,
    );

    expect(container.querySelectorAll(".streak-day")).toHaveLength(7);
  });

  test("marks a day with plays apart from one without", () => {
    const { container } = render(<Streak current={2} longest={198} days={WEEK} format={days} />);

    expect(
      [...container.querySelectorAll(".streak-day")].map((day) => day.classList.contains("on")),
    ).toEqual(WEEK);
  });

  test("fills the track with the current run's share of the record", () => {
    const { container } = render(<Streak current={99} longest={198} days={WEEK} format={days} />);

    expect(container.querySelector(".streak-fill")).toHaveStyle({ width: "50%" });
  });

  test("leaves the track empty rather than dividing by a record of zero", () => {
    // Every library before its first play, and every filter that matched none.
    const { container } = render(<Streak current={0} longest={0} days={[]} format={days} />);

    expect(container.querySelector(".streak-fill")).toHaveStyle({ width: "0%" });
  });

  test("writes an em dash until the first answer lands", () => {
    // `StreakTiles`' rule since 84a: a zero here is a lie about a history
    // that has not been read yet, and it would be corrected a frame later.
    render(<Streak current={undefined} longest={undefined} days={[]} format={days} />);

    expect(screen.getByText("Current").nextElementSibling).toHaveTextContent("—");
    expect(screen.getByText("Current streak · —")).toBeInTheDocument();
    expect(screen.getByText("Record —")).toBeInTheDocument();
  });

  test("names the week for a reader who cannot see it", () => {
    // Seven bars carry the one thing the figures do not - which of the last
    // seven days had a play - and nothing else on the panel says it.
    render(<Streak current={2} longest={198} days={WEEK} format={days} />);

    expect(screen.getByRole("img")).toHaveAccessibleName("Plays on 5 of the last seven days");
  });
});
