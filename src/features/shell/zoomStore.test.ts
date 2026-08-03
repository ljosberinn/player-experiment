import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadZoom, saveZoom } from "../../ipc";
import { DEFAULT_ZOOM, MAX_ZOOM } from "./zoom";
import { useZoomStore, type ZoomPorts } from "./zoomStore";

vi.mock("../../ipc", () => ({
  loadZoom: vi.fn(async () => null),
  saveZoom: vi.fn(async () => undefined),
}));

const loadZoomMock = vi.mocked(loadZoom);
const saveZoomMock = vi.mocked(saveZoom);

function ports(overrides: Partial<ZoomPorts> = {}): ZoomPorts {
  return { setZoom: vi.fn(async () => undefined), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadZoomMock.mockResolvedValue(null);
  saveZoomMock.mockResolvedValue(undefined);
  useZoomStore.setState({ factor: DEFAULT_ZOOM });
});

describe("restoring at startup", () => {
  it("applies the stored zoom to the webview", async () => {
    loadZoomMock.mockResolvedValue("1.4");
    const p = ports();

    await useZoomStore.getState().load(p);

    expect(useZoomStore.getState().factor).toBe(1.4);
    expect(p.setZoom).toHaveBeenCalledWith(1.4);
  });

  it("starts at 1.0 when nothing is stored", async () => {
    const p = ports();

    await useZoomStore.getState().load(p);

    // Phase 21a rebased the density so 1.0 is the right size, not a fallback.
    expect(useZoomStore.getState().factor).toBe(DEFAULT_ZOOM);
  });

  it("still starts when the setting cannot be read", async () => {
    loadZoomMock.mockRejectedValue(new Error("database is locked"));
    const p = ports();

    await expect(useZoomStore.getState().load(p)).resolves.toBeUndefined();
    expect(useZoomStore.getState().factor).toBe(DEFAULT_ZOOM);
  });

  it("still starts when the webview refuses the zoom", async () => {
    // A window that never appears is a far worse failure than one at 100%.
    const p = ports({ setZoom: vi.fn(async () => Promise.reject(new Error("no"))) });

    await expect(useZoomStore.getState().load(p)).resolves.toBeUndefined();
  });
});

describe("changing the zoom", () => {
  it("applies and persists", async () => {
    const p = ports();

    await useZoomStore.getState().set(1.5, p);

    expect(p.setZoom).toHaveBeenCalledWith(1.5);
    expect(saveZoomMock).toHaveBeenCalledWith("1.5");
  });

  it("clamps what the caller asks for", async () => {
    const p = ports();

    await useZoomStore.getState().set(99, p);

    expect(useZoomStore.getState().factor).toBe(MAX_ZOOM);
  });

  it("does nothing when the value has not moved", async () => {
    const p = ports();

    await useZoomStore.getState().set(DEFAULT_ZOOM, p);

    // A range input fires on every pointer move, including the ones that land
    // on the value it already had.
    expect(p.setZoom).not.toHaveBeenCalled();
    expect(saveZoomMock).not.toHaveBeenCalled();
  });

  it("does not persist a zoom the webview rejected", async () => {
    const p = ports({ setZoom: vi.fn(async () => Promise.reject(new Error("no"))) });

    await useZoomStore.getState().set(1.5, p);

    // Remembering it would restore a zoom that never applied.
    expect(saveZoomMock).not.toHaveBeenCalled();
  });

  it("steps and resets through the same path as the slider", async () => {
    const p = ports();

    await useZoomStore.getState().step(1, p);
    expect(useZoomStore.getState().factor).toBe(1.1);

    await useZoomStore.getState().step(-1, p);
    expect(useZoomStore.getState().factor).toBe(DEFAULT_ZOOM);

    await useZoomStore.getState().set(1.6, p);
    await useZoomStore.getState().reset(p);

    // The shortcuts and the slider converge on one value rather than two,
    // which is the whole reason the keys are handled rather than left to the
    // webview.
    expect(useZoomStore.getState().factor).toBe(DEFAULT_ZOOM);
  });
});
