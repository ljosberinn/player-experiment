import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDynamicBackground, saveDynamicBackground } from "../../ipc";
import { useDynamicBackgroundStore } from "./dynamicBackgroundStore";

vi.mock("../../ipc", () => ({
  loadDynamicBackground: vi.fn(async () => true),
  saveDynamicBackground: vi.fn(async () => undefined),
}));

const loadMock = vi.mocked(loadDynamicBackground);
const saveMock = vi.mocked(saveDynamicBackground);

beforeEach(() => {
  vi.clearAllMocks();
  loadMock.mockResolvedValue(true);
  saveMock.mockResolvedValue(undefined);
  useDynamicBackgroundStore.setState({ enabled: true });
});

describe("the dynamic background preference", () => {
  it("starts on, before anything has been read", () => {
    // The design draws the blobs, so on is what the app is rather than a
    // guess it makes while it waits.
    expect(useDynamicBackgroundStore.getState().enabled).toBe(true);
  });

  it("applies a stored off", async () => {
    loadMock.mockResolvedValue(false);

    await useDynamicBackgroundStore.getState().load();

    expect(useDynamicBackgroundStore.getState().enabled).toBe(false);
  });

  it("stays on when the setting cannot be read", async () => {
    loadMock.mockRejectedValue(new Error("no database"));

    await useDynamicBackgroundStore.getState().load();

    expect(useDynamicBackgroundStore.getState().enabled).toBe(true);
  });

  it("persists a change", async () => {
    await useDynamicBackgroundStore.getState().set(false);

    expect(useDynamicBackgroundStore.getState().enabled).toBe(false);
    expect(saveMock).toHaveBeenCalledWith(false);
  });

  it("writes nothing when the value has not changed", async () => {
    await useDynamicBackgroundStore.getState().set(true);

    expect(saveMock).not.toHaveBeenCalled();
  });

  it("keeps what was asked for when the write fails", async () => {
    saveMock.mockRejectedValue(new Error("disk full"));

    await useDynamicBackgroundStore.getState().set(false);

    // The checkbox answers the click. Snapping it back would tell the user
    // their setting was refused, when what happened is that it was not saved.
    expect(useDynamicBackgroundStore.getState().enabled).toBe(false);
  });

  it("toggles both ways", async () => {
    await useDynamicBackgroundStore.getState().toggle();
    expect(useDynamicBackgroundStore.getState().enabled).toBe(false);

    await useDynamicBackgroundStore.getState().toggle();
    expect(useDynamicBackgroundStore.getState().enabled).toBe(true);

    expect(saveMock.mock.calls.map(([enabled]) => enabled)).toEqual([false, true]);
  });
});
