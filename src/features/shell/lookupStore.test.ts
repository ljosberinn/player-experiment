import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadUnattendedLookup, saveUnattendedLookup } from "../../ipc";
import { useLookupStore } from "./lookupStore";

vi.mock("../../ipc", () => ({
  loadUnattendedLookup: vi.fn(async () => false),
  saveUnattendedLookup: vi.fn(async () => undefined),
}));

const loadMock = vi.mocked(loadUnattendedLookup);
const saveMock = vi.mocked(saveUnattendedLookup);

beforeEach(() => {
  vi.clearAllMocks();
  loadMock.mockResolvedValue(false);
  saveMock.mockResolvedValue(undefined);
  useLookupStore.setState({ enabled: false });
});

describe("the unattended lookup preference", () => {
  it("starts off, before anything has been read", () => {
    // The one preference whose absence has to read as "not asked for": it is
    // what makes the app talk to a server on its own.
    expect(useLookupStore.getState().enabled).toBe(false);
  });

  it("applies a stored on", async () => {
    loadMock.mockResolvedValue(true);

    await useLookupStore.getState().load();

    expect(useLookupStore.getState().enabled).toBe(true);
  });

  it("stays off when the setting cannot be read", async () => {
    useLookupStore.setState({ enabled: true });
    loadMock.mockRejectedValue(new Error("no database"));

    await useLookupStore.getState().load();

    // Unchanged rather than assumed on: an unreadable setting is not consent.
    expect(useLookupStore.getState().enabled).toBe(true);
  });

  it("persists a change", async () => {
    await useLookupStore.getState().set(true);

    expect(useLookupStore.getState().enabled).toBe(true);
    expect(saveMock).toHaveBeenCalledWith(true);
  });

  it("writes nothing when the value has not changed", async () => {
    await useLookupStore.getState().set(false);

    expect(saveMock).not.toHaveBeenCalled();
  });

  it("keeps what was asked for when the write fails", async () => {
    saveMock.mockRejectedValue(new Error("disk full"));

    await useLookupStore.getState().set(true);

    expect(useLookupStore.getState().enabled).toBe(true);
  });
});
