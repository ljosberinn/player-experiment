import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GlobalShortcutPorts } from "./globalKeys";
import { usePlayerStore } from "./store";
import { useGlobalMediaKeys } from "./useGlobalMediaKeys";

vi.mock("../../ipc", () => ({
  playerToggle: vi.fn(async () => undefined),
  playerNext: vi.fn(async () => undefined),
  playerPrevious: vi.fn(async () => undefined),
  playerStop: vi.fn(async () => undefined),
  playerPause: vi.fn(async () => undefined),
  playerResume: vi.fn(async () => undefined),
  playerSeek: vi.fn(async () => undefined),
  playerSetVolume: vi.fn(async () => undefined),
  playerPlay: vi.fn(async () => undefined),
  playerSnapshot: vi.fn(async () => null),
  onPlayerState: vi.fn(async () => () => {}),
  onPlayerPosition: vi.fn(async () => () => {}),
  onPlayerError: vi.fn(async () => () => {}),
}));

function ports(overrides: Partial<GlobalShortcutPorts> = {}): GlobalShortcutPorts {
  return {
    register: vi.fn(async () => undefined),
    unregister: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("useGlobalMediaKeys", () => {
  it("claims the keys once the app is running", async () => {
    const p = ports();

    renderHook(() => useGlobalMediaKeys(p));

    await waitFor(() => expect(p.register).toHaveBeenCalledTimes(4));
  });

  it("drives the player when a key fires", async () => {
    const handlers = new Map<string, () => void>();
    const p = ports({
      register: vi.fn(async (accelerator, handler) => {
        handlers.set(accelerator, handler);
      }),
    });
    const toggle = vi.fn(async () => undefined);
    usePlayerStore.setState({ toggle });

    renderHook(() => useGlobalMediaKeys(p));
    await waitFor(() => expect(handlers.size).toBe(4));
    handlers.get("MediaPlayPause")?.();

    expect(toggle).toHaveBeenCalled();
  });

  it("releases the keys on unmount", async () => {
    const p = ports();
    const { unmount } = renderHook(() => useGlobalMediaKeys(p));
    await waitFor(() => expect(p.register).toHaveBeenCalledTimes(4));

    unmount();

    // A killed app that left its keys registered has the OS routing them to
    // nothing at all.
    await waitFor(() => expect(p.unregister).toHaveBeenCalledTimes(4));
  });

  it("releases keys that arrive after unmount", async () => {
    // Resolvers are collected rather than held one at a time: registration is
    // sequential, so resolving only the first leaves the loop waiting on the
    // second forever and the test proves nothing.
    const resolvers: Array<() => void> = [];
    const p = ports({
      register: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    });

    const { unmount } = renderHook(() => useGlobalMediaKeys(p));
    await waitFor(() => expect(resolvers).toHaveLength(1));

    // Unmount while registration is still in flight.
    unmount();
    for (let i = 0; i < 4; i++) {
      await waitFor(() => expect(resolvers.length).toBeGreaterThan(i));
      resolvers[i]?.();
    }

    // The cleanup already ran, with nothing claimed yet. Without the cancelled
    // flag these four would stay held by a window that has gone.
    await waitFor(() => expect(p.unregister).toHaveBeenCalledTimes(4));
  });
});
