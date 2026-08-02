import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEEK_STEP_MS, VOLUME_STEP } from "./shortcuts";
import { usePlayerStore } from "./store";
import { usePlayerShortcuts } from "./usePlayerShortcuts";

vi.mock("./store", () => {
  const state = {
    positionMs: 0,
    volume: 0.5,
    toggle: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
  };
  return { usePlayerStore: { getState: () => state } };
});

const store = usePlayerStore.getState();

function Harness() {
  usePlayerShortcuts();
  return (
    <>
      <input aria-label="Search" />
      {/* biome-ignore lint/a11y/useSemanticElements: standing in for a table row */}
      <div role="row" tabIndex={0} aria-label="Row" />
    </>
  );
}

beforeEach(() => {
  Object.assign(store, { positionMs: 0, volume: 0.5 });
  render(<Harness />);
});

describe("usePlayerShortcuts", () => {
  it("toggles playback on space", async () => {
    await userEvent.keyboard(" ");
    expect(store.toggle).toHaveBeenCalledOnce();
  });

  it("steps the queue with the media keys", async () => {
    await userEvent.keyboard("{MediaTrackNext}{MediaTrackPrevious}");
    expect(store.next).toHaveBeenCalledOnce();
    expect(store.previous).toHaveBeenCalledOnce();
  });

  it("seeks relative to the current position", async () => {
    Object.assign(store, { positionMs: 30_000 });

    await userEvent.keyboard("{ArrowRight}");
    expect(store.seek).toHaveBeenLastCalledWith(30_000 + SEEK_STEP_MS);

    await userEvent.keyboard("{ArrowLeft}");
    expect(store.seek).toHaveBeenLastCalledWith(30_000 - SEEK_STEP_MS);
  });

  it("steps the volume, leaving the clamp to the store", async () => {
    await userEvent.keyboard("{ArrowUp}");
    expect(store.setVolume).toHaveBeenLastCalledWith(0.5 + VOLUME_STEP);

    await userEvent.keyboard("{ArrowDown}");
    expect(store.setVolume).toHaveBeenLastCalledWith(0.5 - VOLUME_STEP);
  });

  it("stays out of the way while the user is typing", async () => {
    await userEvent.click(screen.getByLabelText("Search"));
    await userEvent.keyboard("a b");

    expect(store.toggle).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Search")).toHaveValue("a b");
  });

  it("still fires when focus is on a row rather than the body", async () => {
    screen.getByRole("row").focus();
    await userEvent.keyboard(" ");

    expect(store.toggle).toHaveBeenCalledOnce();
  });

  it("leaves keys it does not own to the app", async () => {
    await userEvent.keyboard("{Enter}x{Tab}");

    expect(store.toggle).not.toHaveBeenCalled();
    expect(store.seek).not.toHaveBeenCalled();
    expect(store.setVolume).not.toHaveBeenCalled();
  });

  it("unbinds on unmount", async () => {
    const { unmount } = render(<Harness />);
    unmount();
    vi.mocked(store.toggle).mockClear();

    // The first Harness is still mounted, so exactly one handler should remain.
    await userEvent.keyboard(" ");
    expect(store.toggle).toHaveBeenCalledOnce();
  });
});
