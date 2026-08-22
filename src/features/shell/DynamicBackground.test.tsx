import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Colour } from "../../ipc";
import { usePlayerStore } from "../player/store";
import { DynamicBackground } from "./DynamicBackground";
import { useDynamicBackgroundStore } from "./dynamicBackgroundStore";

const PALETTE: Colour[] = [
  { r: 64, g: 64, b: 64 },
  { r: 112, g: 96, b: 96 },
  { r: 224, g: 224, b: 224 },
];

function layer(): HTMLElement | null {
  return screen.queryByTestId("dynamic-background");
}

describe("DynamicBackground", () => {
  beforeEach(() => {
    usePlayerStore.setState({ palette: null });
    useDynamicBackgroundStore.setState({ enabled: true });
  });

  it("renders nothing when nothing is playing", () => {
    render(<DynamicBackground />);

    // Nothing rather than an empty layer: a fixed, blurred, animating element
    // is not free at zero opacity, and silence is the resting state.
    expect(layer()).toBeNull();
  });

  it("renders nothing for a track with no artwork", () => {
    // The backend reports the same `null` for a track without a cover as for
    // silence, which is the point: both mean no blobs.
    usePlayerStore.setState({ palette: null });
    render(<DynamicBackground />);

    expect(layer()).toBeNull();
  });

  it("paints the playing cover's three colours", () => {
    usePlayerStore.setState({ palette: PALETTE });
    render(<DynamicBackground />);

    const found = layer();
    expect(found).not.toBeNull();
    expect(found?.style.getPropertyValue("--blob-1")).toBe("rgb(64 64 64)");
    expect(found?.style.getPropertyValue("--blob-2")).toBe("rgb(112 96 96)");
    expect(found?.style.getPropertyValue("--blob-3")).toBe("rgb(224 224 224)");
  });

  it("renders nothing when the preference is off", () => {
    usePlayerStore.setState({ palette: PALETTE });
    useDynamicBackgroundStore.setState({ enabled: false });
    render(<DynamicBackground />);

    expect(layer()).toBeNull();
  });

  it("comes back when the preference is turned on again", () => {
    usePlayerStore.setState({ palette: PALETTE });
    useDynamicBackgroundStore.setState({ enabled: false });
    const { rerender } = render(<DynamicBackground />);
    expect(layer()).toBeNull();

    act(() => {
      useDynamicBackgroundStore.setState({ enabled: true });
    });
    rerender(<DynamicBackground />);

    expect(layer()).not.toBeNull();
  });

  it("is hidden from assistive technology", () => {
    usePlayerStore.setState({ palette: PALETTE });
    render(<DynamicBackground />);

    // Decoration with nothing to say. A screen reader that announced it would
    // be announcing the colour of the wallpaper.
    expect(layer()).toHaveAttribute("aria-hidden", "true");
  });

  it("fills the third blob from the last colour when a palette is short", () => {
    // The backend always sends three. A palette stored by an older build might
    // not, and a blob left at its registered `transparent` initial value would
    // be a hole in the field rather than a quieter version of it.
    usePlayerStore.setState({ palette: [{ r: 10, g: 20, b: 30 }] });
    render(<DynamicBackground />);

    const found = layer();
    expect(found?.style.getPropertyValue("--blob-1")).toBe("rgb(10 20 30)");
    expect(found?.style.getPropertyValue("--blob-2")).toBe("rgb(10 20 30)");
    expect(found?.style.getPropertyValue("--blob-3")).toBe("rgb(10 20 30)");
  });

  it("renders nothing for an empty palette", () => {
    usePlayerStore.setState({ palette: [] });
    render(<DynamicBackground />);

    expect(layer()).toBeNull();
  });
});
