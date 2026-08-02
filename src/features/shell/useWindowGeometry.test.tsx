import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadWindowGeometry, saveWindowGeometry } from "../../ipc";
import { GEOMETRY_DEBOUNCE_MS, useWindowGeometry } from "./useWindowGeometry";

vi.mock("../../ipc", () => ({
  loadWindowGeometry: vi.fn(),
  saveWindowGeometry: vi.fn(),
}));

const appWindow = {
  isMaximized: vi.fn(async () => false),
  outerPosition: vi.fn(async () => ({ x: 300, y: 200 })),
  outerSize: vi.fn(async () => ({ width: 1400, height: 900 })),
  setPosition: vi.fn(async (_position: { x: number; y: number }) => {}),
  setSize: vi.fn(async (_size: { width: number; height: number }) => {}),
  maximize: vi.fn(async () => {}),
  show: vi.fn(async () => {}),
  onMoved: vi.fn(async (handler: () => void) => {
    moved = handler;
    return () => {};
  }),
  onResized: vi.fn(async () => () => {}),
};
let moved: (() => void) | null = null;
const monitors = vi.fn(async () => [
  { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
]);

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => appWindow,
  availableMonitors: () => monitors(),
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
  PhysicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));

const stored = '{"x":100,"y":80,"width":1200,"height":800,"maximized":false}';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  moved = null;
  appWindow.isMaximized.mockResolvedValue(false);
  monitors.mockResolvedValue([{ position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }]);
});

describe("useWindowGeometry", () => {
  it("puts the window back where it was", async () => {
    vi.mocked(loadWindowGeometry).mockResolvedValue(stored);

    renderHook(() => useWindowGeometry());

    await waitFor(() => expect(appWindow.setPosition).toHaveBeenCalled());
    expect(appWindow.setPosition.mock.calls[0]?.[0]).toMatchObject({ x: 100, y: 80 });
    expect(appWindow.setSize.mock.calls[0]?.[0]).toMatchObject({ width: 1200, height: 800 });
    expect(appWindow.maximize).not.toHaveBeenCalled();
  });

  it("leaves a first launch alone", async () => {
    vi.mocked(loadWindowGeometry).mockResolvedValue(null);

    renderHook(() => useWindowGeometry());

    await waitFor(() => expect(appWindow.onMoved).toHaveBeenCalled());
    expect(appWindow.setPosition).not.toHaveBeenCalled();
  });

  it("refuses a position on a monitor that is no longer attached", async () => {
    vi.mocked(loadWindowGeometry).mockResolvedValue('{"x":-4000,"y":80,"width":1200,"height":800}');

    renderHook(() => useWindowGeometry());

    await waitFor(() => expect(appWindow.onMoved).toHaveBeenCalled());
    // Otherwise the window opens somewhere the user cannot see or reach.
    expect(appWindow.setPosition).not.toHaveBeenCalled();
  });

  it("restores a maximized window as maximized", async () => {
    vi.mocked(loadWindowGeometry).mockResolvedValue(
      '{"x":100,"y":80,"width":1200,"height":800,"maximized":true}',
    );

    renderHook(() => useWindowGeometry());

    await waitFor(() => expect(appWindow.maximize).toHaveBeenCalled());
  });

  it("writes the new position once a drag settles", async () => {
    vi.mocked(loadWindowGeometry).mockResolvedValue(null);
    renderHook(() => useWindowGeometry());
    await waitFor(() => expect(appWindow.onMoved).toHaveBeenCalled());

    // Moving a window emits an event per frame.
    moved?.();
    moved?.();
    moved?.();

    await waitFor(
      () =>
        expect(saveWindowGeometry).toHaveBeenCalledWith(
          '{"x":300,"y":200,"width":1400,"height":900,"maximized":false}',
        ),
      { timeout: GEOMETRY_DEBOUNCE_MS * 4 },
    );
    expect(saveWindowGeometry).toHaveBeenCalledTimes(1);
  });

  it("keeps the un-maximized size when the window is maximized", async () => {
    vi.mocked(loadWindowGeometry).mockResolvedValue(stored);
    appWindow.isMaximized.mockResolvedValue(true);
    renderHook(() => useWindowGeometry());
    await waitFor(() => expect(appWindow.onMoved).toHaveBeenCalled());

    moved?.();

    // Storing the maximized bounds would restore a manually-sized window that
    // happens to fill the screen, which un-maximizing then cannot undo.
    await waitFor(() =>
      expect(saveWindowGeometry).toHaveBeenCalledWith(
        '{"x":100,"y":80,"width":1200,"height":800,"maximized":true}',
      ),
    );
  });

  it("does not fail the app when the window will not answer", async () => {
    vi.mocked(loadWindowGeometry).mockRejectedValue("db is locked");

    // Losing a window position is not worth interrupting anyone over.
    expect(() => renderHook(() => useWindowGeometry())).not.toThrow();
    await waitFor(() => expect(loadWindowGeometry).toHaveBeenCalled());
  });
});

describe("showing the window", () => {
  it("shows it once the stored geometry has been applied", async () => {
    vi.mocked(loadWindowGeometry).mockResolvedValue(
      JSON.stringify({ x: 100, y: 120, width: 1200, height: 800, maximized: false }),
    );

    renderHook(() => useWindowGeometry());

    // The window starts hidden so it is never seen at the default size and
    // position before jumping to the stored one.
    await waitFor(() => expect(appWindow.show).toHaveBeenCalled());
    expect(appWindow.setPosition).toHaveBeenCalledBefore(appWindow.show);
  });

  it("shows it even when there is nothing stored", async () => {
    vi.mocked(loadWindowGeometry).mockResolvedValue(null);

    renderHook(() => useWindowGeometry());

    await waitFor(() => expect(appWindow.show).toHaveBeenCalled());
  });

  it("shows it even when restoring the geometry fails", async () => {
    vi.mocked(loadWindowGeometry).mockRejectedValue("database is locked");

    renderHook(() => useWindowGeometry());

    // A window that never appears is a far worse failure than one in the
    // wrong place, so this must not be inside the try that restores.
    await waitFor(() => expect(appWindow.show).toHaveBeenCalled());
  });

  it("shows it even when the position cannot be set", async () => {
    vi.mocked(loadWindowGeometry).mockResolvedValue(
      JSON.stringify({ x: 100, y: 120, width: 1200, height: 800, maximized: false }),
    );
    appWindow.setPosition.mockRejectedValueOnce(new Error("not allowed by ACL"));

    renderHook(() => useWindowGeometry());

    await waitFor(() => expect(appWindow.show).toHaveBeenCalled());
  });
});
