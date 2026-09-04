import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { StatTile } from "./StatTile";

describe("StatTile", () => {
  test("reads as its label followed by its value", () => {
    // A tile is a term and its definition, not two loose strings: read out of
    // order - "12,480" then "Plays" - it says nothing, and a row of six tiles
    // announces twelve unrelated fragments.
    render(<StatTile label="Plays" value="12,480" />);

    const term = screen.getByText("Plays");
    expect(term.tagName).toBe("DT");
    expect(term.nextElementSibling).toHaveTextContent("12,480");
  });

  test("leaves out the secondary line when there is none", () => {
    // Most tiles are a number and nothing else. An empty element in its place
    // still takes the line's height, so a row of tiles would be ragged.
    const { container } = render(<StatTile label="Plays" value="12,480" />);

    expect(container.querySelectorAll("dd")).toHaveLength(1);
  });

  test("hangs the secondary line off the same label", () => {
    // "of which 84% owned" is about the plays above it, so it is a second
    // definition of the same term rather than a tile of its own.
    render(<StatTile label="Plays" value="12,480" secondary="84% owned" />);

    expect(screen.getByText("84% owned").tagName).toBe("DD");
  });
});
