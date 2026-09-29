import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDiscordPresence, saveDiscordPresence } from "../../ipc";
import { usePresenceStore } from "./presenceStore";

vi.mock("../../ipc", () => ({
  loadDiscordPresence: vi.fn(async () => false),
  saveDiscordPresence: vi.fn(async () => undefined),
}));

const loadMock = vi.mocked(loadDiscordPresence);
const saveMock = vi.mocked(saveDiscordPresence);

beforeEach(() => {
  vi.clearAllMocks();
  loadMock.mockResolvedValue(false);
  saveMock.mockResolvedValue(undefined);
  usePresenceStore.setState({ enabled: false });
});

describe("the Discord presence preference", () => {
  it("starts off, before anything has been read", () => {
    expect(usePresenceStore.getState().enabled).toBe(false);
  });

  it("applies a stored on", async () => {
    loadMock.mockResolvedValue(true);

    await usePresenceStore.getState().load();

    expect(usePresenceStore.getState().enabled).toBe(true);
  });

  it("persists a change", async () => {
    await usePresenceStore.getState().set(true);

    expect(usePresenceStore.getState().enabled).toBe(true);
    expect(saveMock).toHaveBeenCalledWith(true);
  });

  it("writes nothing when the value has not changed", async () => {
    await usePresenceStore.getState().set(false);

    expect(saveMock).not.toHaveBeenCalled();
  });

  it("keeps what was asked for when the write fails", async () => {
    saveMock.mockRejectedValue(new Error("disk full"));

    await usePresenceStore.getState().set(true);

    expect(usePresenceStore.getState().enabled).toBe(true);
  });
});
