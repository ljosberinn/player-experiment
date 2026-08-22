import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportLibrary, onExportProgress } from "../../ipc";
import { useExportStore } from "./store";

vi.mock("../../ipc", () => ({
  exportLibrary: vi.fn(),
  onExportProgress: vi.fn(async () => () => {}),
}));

const exportLibraryMock = vi.mocked(exportLibrary);
const onExportProgressMock = vi.mocked(onExportProgress);

beforeEach(() => {
  vi.clearAllMocks();
  onExportProgressMock.mockImplementation(async () => () => {});
  useExportStore.setState({ progress: null, busy: false });
});

describe("useExportStore", () => {
  it("is busy for as long as the export runs", async () => {
    let finish: ((count: number) => void) | undefined;
    exportLibraryMock.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );

    const running = useExportStore.getState().run("C:/out.json", { kind: "library" });
    expect(useExportStore.getState().busy).toBe(true);

    finish?.(42);

    expect(await running).toBe(42);
    expect(useExportStore.getState().busy).toBe(false);
  });

  it("stops being busy when the export fails", async () => {
    exportLibraryMock.mockRejectedValue(new Error("disk full"));

    // The caller reports the failure; what matters here is that a readout is
    // not left on screen describing an export that is not happening.
    await expect(
      useExportStore.getState().run("C:/out.json", { kind: "library" }),
    ).rejects.toThrow();
    expect(useExportStore.getState().busy).toBe(false);
    expect(useExportStore.getState().progress).toBeNull();
  });

  it("records progress from export events", async () => {
    let emit: ((progress: { done: number; total: number }) => void) | undefined;
    onExportProgressMock.mockImplementation(async (handler) => {
      emit = handler;
      return () => {};
    });

    await useExportStore.getState().watch();
    emit?.({ done: 1000, total: 4200 });

    expect(useExportStore.getState().progress).toEqual({ done: 1000, total: 4200 });
  });
});
