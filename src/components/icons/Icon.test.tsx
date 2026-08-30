import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "./Icon";
import { ICONS, type IconName } from "./registry";

const NAMES = Object.keys(ICONS) as IconName[];

/**
 * The adapter, not the artwork.
 *
 * Nothing here asserts what an icon looks like - that is the library's job and
 * a picture's, not a test's. What it holds is the contract that makes the
 * library replaceable: every name in the registry resolves, and every icon
 * comes out decorative and at the size it was asked for, whichever family is
 * behind it.
 */
describe("Icon", () => {
  it("resolves every name in the registry", () => {
    // Guards the guard: an empty registry would iterate nothing and pass.
    expect(NAMES.length).toBeGreaterThan(10);

    for (const name of NAMES) {
      const { container, unmount } = render(<Icon name={name} size={16} />);

      expect(container.querySelector("svg"), `${name} should render a glyph`).not.toBeNull();
      unmount();
    }
  });

  it("draws at the size it is given, rather than off the font", () => {
    const { container } = render(<Icon name="play" size={22} />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("width", "22");
    expect(svg).toHaveAttribute("height", "22");
  });

  it("is decorative, because every icon here sits beside its own label", () => {
    // Otherwise a screen reader announces the button's label and then the
    // icon's, which is the same thing said twice.
    const { container } = render(<Icon name="volume-muted" size={16} className="volume-mark" />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveClass("volume-mark");
  });
});
