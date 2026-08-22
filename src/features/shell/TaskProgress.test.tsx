import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track, WriteProgress } from "../../ipc";
import { onExportProgress, onTagWriteProgress } from "../../ipc";
import { useEditorStore } from "../editor/store";
import { useExportStore } from "../export/store";
import { TaskProgress } from "./TaskProgress";

vi.mock("../../ipc", () => ({
  exportLibrary: vi.fn(),
  onExportProgress: vi.fn(),
  onTagWriteProgress: vi.fn(),
  tracksByIds: vi.fn(),
  writeTags: vi.fn(),
  undoTagEdit: vi.fn(),
  canUndoTagEdit: vi.fn(async () => false),
  countTracks: vi.fn(async () => 0),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0 })),
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
}));

const onExportProgressMock = vi.mocked(onExportProgress);
const onTagWriteProgressMock = vi.mocked(onTagWriteProgress);

/** The handlers the component registers, so tests can drive the two channels. */
let emitExport: ((progress: WriteProgress) => void) | undefined;
let emitTags: ((progress: WriteProgress) => void) | undefined;
const stopExport = vi.fn();
const stopTags = vi.fn();

function track(id: number): Track {
  return {
    id,
    path: `/m/${id}.mp3`,
    duration_ms: 1000,
    title: `Track ${id}`,
    artist: null,
    album: null,
    album_artist: null,
    genre: null,
    year: null,
    track_no: null,
    disc_no: null,
    comment: null,
    bitrate: null,
    sample_rate: null,
    cover_hash: null,
    added_at: 0,
    play_count: 0,
    last_played_at: null,
    missing_since: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  emitExport = undefined;
  emitTags = undefined;
  onExportProgressMock.mockImplementation(async (handler) => {
    emitExport = handler;
    return stopExport;
  });
  onTagWriteProgressMock.mockImplementation(async (handler) => {
    emitTags = handler;
    return stopTags;
  });
  // Both stores are module singletons; a task left running by one test would
  // otherwise still be on screen at the start of the next.
  useExportStore.setState({ progress: null, busy: false });
  useEditorStore.setState({ progress: null, tracks: null });
});

async function mounted() {
  const view = render(<TaskProgress />);
  await waitFor(() => expect(emitExport).toBeDefined());
  await waitFor(() => expect(emitTags).toBeDefined());
  return view;
}

describe("TaskProgress", () => {
  it("says nothing while nothing is running", async () => {
    await mounted();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reports an export as a fraction", async () => {
    await mounted();

    act(() => {
      useExportStore.setState({ busy: true });
      emitExport?.({ done: 1200, total: 5000 });
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      `Exporting ${(1200).toLocaleString()} of ${(5000).toLocaleString()}`,
    );
  });

  it("says only that an export is running before its first report", async () => {
    await mounted();

    act(() => {
      useExportStore.setState({ busy: true });
    });

    expect(screen.getByRole("status")).toHaveTextContent("Exporting…");
  });

  it("reports a tag undo, which has no dialog to report in", async () => {
    await mounted();

    act(() => {
      emitTags?.({ done: 3, total: 12 });
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      `Reverting ${(3).toLocaleString()} of ${(12).toLocaleString()}`,
    );
  });

  it("leaves a tag save to the dialog it is already showing in", async () => {
    await mounted();

    act(() => {
      // An open editor means this write is a save, and the modal in front of
      // this line is where the user is looking.
      useEditorStore.setState({ tracks: [track(1)] });
      emitTags?.({ done: 3, total: 12 });
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("unsubscribes from both channels on unmount", async () => {
    const { unmount } = await mounted();

    unmount();

    await waitFor(() => expect(stopExport).toHaveBeenCalled());
    expect(stopTags).toHaveBeenCalled();
  });
});
