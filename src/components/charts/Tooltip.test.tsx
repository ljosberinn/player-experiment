import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { TOOLTIP_WIDTH, Tooltip } from "./Tooltip";

/** Where the tooltip placed itself, as the two numbers it wrote inline. */
function placed(): { left: string; top: string } {
  const { style } = screen.getByRole("tooltip");
  return { left: style.left, top: style.top };
}

describe("Tooltip", () => {
  test("centres on the point it was given", () => {
    render(
      <Tooltip x={200} y={40} within={500}>
        41 plays
      </Tooltip>,
    );

    expect(placed()).toStrictEqual({ left: "200px", top: "40px" });
  });

  test("stays inside the plot when the point is against its edge", () => {
    // Hovering the last bar of a chart is not an edge case, it is where the
    // most recent month is. Half a tooltip hanging off the side is the default
    // behaviour of an absolutely positioned box, so it has to be taken away.
    render(
      <Tooltip x={495} y={40} within={500}>
        41 plays
      </Tooltip>,
    );

    expect(placed().left).toBe(`${500 - TOOLTIP_WIDTH / 2}px`);
  });
});
