import { beforeEach, describe, expect, it, vi } from "vitest";
import { lovedTracks, setLoved } from "../../ipc";
import { useStatusStore } from "../shell/statusStore";
import { useLovedStore } from "./store";

vi.mock("../../ipc", () => ({
  lovedTracks: vi.fn(async () => [] as number[]),
  setLoved: vi.fn(async () => [] as number[]),
  onLovedChanged: vi.fn(async (handler: () => void) => {
    changedHandler = handler;
    return () => {
      changedHandler = null;
    };
  }),
}));

let changedHandler: (() => void) | null = null;

const asMock = vi.mocked;

beforeEach(() => {
  vi.clearAllMocks();
  useLovedStore.setState({ loved: new Set<number>() });
  useStatusStore.setState({ message: null, notice: null });
  asMock(lovedTracks).mockResolvedValue([]);
  asMock(setLoved).mockResolvedValue([]);
});

describe("the loved set", () => {
  it("reads the whole set, which is what the song menu asks of it", async () => {
    asMock(lovedTracks).mockResolvedValue([4, 9]);

    await useLovedStore.getState().load();

    expect([...useLovedStore.getState().loved]).toEqual([4, 9]);
  });

  it("leaves the set alone when the read fails", async () => {
    // An empty set would make every menu offer Love on a song the user has
    // already loved, and nobody asked for this read.
    useLovedStore.setState({ loved: new Set([4]) });
    asMock(lovedTracks).mockRejectedValue("no");

    await useLovedStore.getState().load();

    expect([...useLovedStore.getState().loved]).toEqual([4]);
  });

  it("answers before the backend has", async () => {
    let finish: (ids: number[]) => void = () => {};
    asMock(setLoved).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    const loving = useLovedStore.getState().love([4], true);
    expect(useLovedStore.getState().loved.has(4)).toBe(true);

    finish([4]);
    await loving;
    expect([...useLovedStore.getState().loved]).toEqual([4]);
  });

  it("takes the backend's set over its own guess", async () => {
    // Two library rows can share one match key, so loving either loves both
    // - which the window has no way to work out for itself.
    asMock(setLoved).mockResolvedValue([4, 11]);

    await useLovedStore.getState().love([4], true);

    expect([...useLovedStore.getState().loved]).toEqual([4, 11]);
  });

  it("drops the row again on an unlove", async () => {
    useLovedStore.setState({ loved: new Set([4]) });

    await useLovedStore.getState().love([4], false);

    expect(setLoved).toHaveBeenCalledWith([4], false);
    expect(useLovedStore.getState().loved.has(4)).toBe(false);
  });

  it("reports a refusal and puts the set back", async () => {
    useLovedStore.setState({ loved: new Set([4]) });
    asMock(setLoved).mockRejectedValue("A song needs both an artist and a title.");

    await useLovedStore.getState().love([9], true);

    expect(useStatusStore.getState().message).toMatch(/artist and a title/);
    expect([...useLovedStore.getState().loved]).toEqual([4]);
  });

  it("re-reads the set when the backend says it moved", async () => {
    await useLovedStore.getState().watch();
    asMock(lovedTracks).mockResolvedValue([7]);

    changedHandler?.();
    await vi.waitFor(() => expect([...useLovedStore.getState().loved]).toEqual([7]));
  });
});
