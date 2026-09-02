import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TagEdit, Track } from "../../ipc";
import { canUndoTagEdit, onTagWriteProgress, tracksByIds, undoTagEdit, writeTags } from "../../ipc";
import { useLibraryStore } from "../library/store";
import { useStatusStore } from "../shell/statusStore";
import { useEditorStore } from "./store";

vi.mock("../../ipc", () => ({
  onTagWriteProgress: vi.fn(async () => () => {}),
  tracksByIds: vi.fn(),
  writeTags: vi.fn(),
  undoTagEdit: vi.fn(),
  canUndoTagEdit: vi.fn(),
  countTracks: vi.fn(async () => 0),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0 })),
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
}));

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

const edit: TagEdit = {
  title: null,
  artist: null,
  album: null,
  albumArtist: null,
  genre: "Dream Pop",
  comment: null,
  year: null,
  trackNo: null,
  discNo: null,
  cover: null,
};

const initialEditor = useEditorStore.getState();
const initialLibrary = useLibraryStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    ...initialEditor,
    tracks: null,
    progress: null,
  });
  useLibraryStore.setState({ ...initialLibrary, total: 0, pages: new Map() });
  useStatusStore.setState({ message: null, notice: null });
  vi.mocked(canUndoTagEdit).mockResolvedValue(false);
});

describe("editor store", () => {
  it("shows a fraction from the moment Save is pressed", async () => {
    vi.mocked(tracksByIds).mockResolvedValue([track(1), track(2)]);
    await useEditorStore.getState().open([1, 2]);
    let finish:
      | ((summary: { written: number; failed: number; errors: string[] }) => void)
      | undefined;
    vi.mocked(writeTags).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    const saving = useEditorStore.getState().save(edit);

    // Not on the first event: the dialog has to go to work when the button is
    // pressed, not when the first of 500 files lands.
    expect(useEditorStore.getState().progress).toEqual({ done: 0, total: 2 });

    finish?.({ written: 2, failed: 0, errors: [] });
    await saving;

    expect(useEditorStore.getState().progress).toBeNull();
  });

  it("clears the readout when a save fails, so the dialog is usable again", async () => {
    vi.mocked(tracksByIds).mockResolvedValue([track(1)]);
    await useEditorStore.getState().open([1]);
    vi.mocked(writeTags).mockRejectedValue(new Error("locked"));

    await useEditorStore.getState().save(edit);

    expect(useEditorStore.getState().progress).toBeNull();
    expect(useEditorStore.getState().tracks).not.toBeNull();
  });

  it("marks an undo as running before it knows how big it is", async () => {
    let finish:
      | ((summary: { written: number; failed: number; errors: string[] }) => void)
      | undefined;
    vi.mocked(undoTagEdit).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    const undoing = useEditorStore.getState().undo();

    // A total of zero, because only the backend knows how many rows the last
    // batch held; the readout says "Reverting" until the first event.
    expect(useEditorStore.getState().progress).toEqual({ done: 0, total: 0 });

    finish?.({ written: 1, failed: 0, errors: [] });
    await undoing;

    expect(useEditorStore.getState().progress).toBeNull();
  });

  it("records progress from tag write events", async () => {
    let emit: ((progress: { done: number; total: number }) => void) | undefined;
    vi.mocked(onTagWriteProgress).mockImplementation(async (handler) => {
      emit = handler;
      return () => {};
    });

    await useEditorStore.getState().watch();
    emit?.({ done: 25, total: 500 });

    expect(useEditorStore.getState().progress).toEqual({ done: 25, total: 500 });
  });

  it("loads the rows behind a selection rather than trusting the cache", async () => {
    vi.mocked(tracksByIds).mockResolvedValue([track(1), track(2)]);

    await useEditorStore.getState().open([1, 2]);

    expect(tracksByIds).toHaveBeenCalledWith([1, 2]);
    expect(useEditorStore.getState().tracks).toHaveLength(2);
  });

  it("does not open on an empty selection", async () => {
    await useEditorStore.getState().open([]);

    expect(tracksByIds).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tracks).toBeNull();
  });

  it("stays closed when every selected row has since vanished", async () => {
    vi.mocked(tracksByIds).mockResolvedValue([]);

    await useEditorStore.getState().open([9999]);

    expect(useEditorStore.getState().tracks).toBeNull();
  });

  it("writes the edit for every open track and refreshes the view", async () => {
    vi.mocked(tracksByIds).mockResolvedValue([track(1), track(2)]);
    vi.mocked(writeTags).mockResolvedValue({ written: 2, failed: 0, errors: [] });
    await useEditorStore.getState().open([1, 2]);
    const before = useLibraryStore.getState().queryToken;

    await useEditorStore.getState().save(edit);

    expect(writeTags).toHaveBeenCalledWith([1, 2], edit);
    expect(useEditorStore.getState().tracks).toBeNull();
    expect(useStatusStore.getState().notice).toBe("Updated 2 songs.");
    expect(useLibraryStore.getState().queryToken).toBeGreaterThan(before);
  });

  it("reports a partial write rather than rounding it to done", async () => {
    vi.mocked(tracksByIds).mockResolvedValue([track(1)]);
    vi.mocked(writeTags).mockResolvedValue({
      written: 3,
      failed: 2,
      errors: ["C:\\m\\4.mp3: access denied"],
    });
    await useEditorStore.getState().open([1]);

    await useEditorStore.getState().save(edit);

    const notice = useStatusStore.getState().notice ?? "";
    expect(notice).toContain("3 songs");
    expect(notice).toContain("2 could not be written");
    expect(notice).toContain("access denied");
  });

  it("keeps the dialog open when the backend refuses the edit", async () => {
    vi.mocked(tracksByIds).mockResolvedValue([track(1)]);
    vi.mocked(writeTags).mockRejectedValue("Year must be a number, or empty to clear.");
    await useEditorStore.getState().open([1]);

    await useEditorStore.getState().save(edit);

    // Closing it would make the user retype everything.
    expect(useEditorStore.getState().tracks).not.toBeNull();
    expect(useStatusStore.getState().message).toContain("Year must be a number");
  });

  it("writes nothing when the dialog is not open", async () => {
    await useEditorStore.getState().save(edit);

    expect(writeTags).not.toHaveBeenCalled();
  });

  it("undoes and re-reads the view", async () => {
    vi.mocked(undoTagEdit).mockResolvedValue({ written: 2, failed: 0, errors: [] });
    const before = useLibraryStore.getState().queryToken;

    await useEditorStore.getState().undo();

    expect(useStatusStore.getState().notice).toBe("Reverted 2 songs.");
    expect(useLibraryStore.getState().queryToken).toBeGreaterThan(before);
  });

  it("surfaces having nothing to undo", async () => {
    vi.mocked(undoTagEdit).mockRejectedValue("There is nothing to undo.");

    await useEditorStore.getState().undo();

    expect(useStatusStore.getState().message).toContain("nothing to undo");
  });

  it("tracks whether an undo is available", async () => {
    vi.mocked(canUndoTagEdit).mockResolvedValue(true);
    await useEditorStore.getState().refreshUndo();
    expect(useEditorStore.getState().canUndo).toBe(true);

    // A failure here leaves the control disabled rather than shouting: the
    // worst case is a button you cannot press, not a lost edit.
    vi.mocked(canUndoTagEdit).mockRejectedValue("db is locked");
    await useEditorStore.getState().refreshUndo();
    expect(useEditorStore.getState().canUndo).toBe(false);
    expect(useStatusStore.getState().message).toBeNull();
  });
});
