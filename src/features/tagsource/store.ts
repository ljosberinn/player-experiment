import { create } from "zustand";
import {
  onTagWriteProgress,
  type ReleaseCandidate,
  type ReleaseDetail,
  type ReleaseSelection,
  type Track,
  type TrackEdit,
  tagsourceApply,
  tagsourceFetch,
  tagsourceGroups,
  tagsourceSearch,
  tracksByIds,
  type WriteProgress,
} from "../../ipc";
import { dismiss, notify, report } from "../shell/statusStore";
import { allFields, type Fields, identityOf } from "./mapping";

/**
 * What the dialog is doing about the release it is on.
 *
 * A release at a time, in a queue, because that is the unit a lookup costs a
 * request at: a folder-wide selection is dozens of releases, and MusicBrainz
 * allows one request a second. The queue is what lets that selection be tagged
 * in one pass without pretending it is one release.
 */
export type Stage = "searching" | "results" | "fetching" | "confirm" | "applying";

interface TagsourceState {
  /** The releases still to work through, or null when the dialog is closed. */
  queue: ReleaseSelection[] | null;
  /** Which of them is on screen. */
  index: number;
  /** The selected files of the current release, in track order. */
  tracks: Track[];
  stage: Stage;
  candidates: ReleaseCandidate[];
  detail: ReleaseDetail | null;
  fields: Fields;
  /** How far an apply has got, or null when none is running. */
  progress: WriteProgress | null;
  /** What went wrong on the current release, if anything. */
  error: string | null;

  /** Groups a selection into releases and opens the dialog on the first. */
  open: (trackIds: number[]) => Promise<void>;
  close: () => void;
  /** Leaves this release alone and moves to the next, or closes. */
  skip: () => Promise<void>;
  /** Runs the search for the release on screen again. */
  search: () => Promise<void>;
  /** Fetches a candidate's tracklist and moves to the confirm step. */
  pick: (mbid: string) => Promise<void>;
  /** Returns from the confirm step to the results without refetching. */
  back: () => void;
  setFields: (fields: Fields) => void;
  /** Writes the confirmed mapping, then moves to the next release. */
  apply: (edits: TrackEdit[]) => Promise<void>;
  /** Subscribes to `tags://progress`; returns its own teardown. */
  watch: () => Promise<() => void>;
}

/** The release the dialog is on, or null when it is closed or past the end. */
function current(state: TagsourceState): ReleaseSelection | null {
  return state.queue?.[state.index] ?? null;
}

export const useTagsourceStore = create<TagsourceState>((set, get) => ({
  queue: null,
  index: 0,
  tracks: [],
  stage: "searching",
  candidates: [],
  detail: null,
  fields: allFields(),
  progress: null,
  error: null,

  open: async (trackIds) => {
    if (trackIds.length === 0) {
      return;
    }
    dismiss();
    try {
      const queue = await tagsourceGroups(trackIds);
      if (queue.length === 0) {
        return;
      }
      set({ queue, index: 0, fields: allFields() });
      await get().search();
    } catch (cause) {
      report(cause);
    }
  },

  close: () => set({ queue: null, tracks: [], candidates: [], detail: null, error: null }),

  skip: async () => {
    const next = get().index + 1;
    if (next >= (get().queue?.length ?? 0)) {
      get().close();
      return;
    }
    set({ index: next });
    await get().search();
  },

  search: async () => {
    const release = current(get());
    if (release === null) {
      return;
    }
    set({ stage: "searching", candidates: [], detail: null, error: null, tracks: [] });
    try {
      // The rows first, and fetched rather than read from the page cache: the
      // selection can name rows a scroll has evicted, and the mapping is about
      // to be built out of their track numbers.
      const tracks = await tracksByIds(release.trackIds);
      set({ tracks });
      const candidates = await tagsourceSearch(release.album, release.artist);
      // Guard against a queue that moved on while the request was in flight -
      // Skip is one click and a search is a rate-limited second.
      if (current(get()) !== release) {
        return;
      }
      set({ candidates, stage: "results" });
    } catch (cause) {
      set({ stage: "results", error: String(cause) });
    }
  },

  pick: async (mbid) => {
    const release = current(get());
    if (release === null) {
      return;
    }
    set({ stage: "fetching", error: null });
    try {
      const detail = await tagsourceFetch(mbid, release.album, release.artist);
      if (current(get()) !== release) {
        return;
      }
      set({ detail, stage: "confirm" });
    } catch (cause) {
      set({ stage: "results", error: String(cause) });
    }
  },

  back: () => set({ detail: null, stage: "results", error: null }),

  setFields: (fields) => set({ fields }),

  apply: async (edits) => {
    const release = current(get());
    const detail = get().detail;
    if (release === null || detail === null) {
      return;
    }
    // Set here rather than on the first event, so the dialog goes to work the
    // moment Apply is pressed instead of when the first file lands.
    set({ stage: "applying", progress: { done: 0, total: edits.length }, error: null });
    try {
      const summary = await tagsourceApply(edits, identityOf(release, detail));
      notify(
        summary.failed === 0
          ? `Tagged ${summary.written} song${summary.written === 1 ? "" : "s"} from MusicBrainz.`
          : `Tagged ${summary.written}; ${summary.failed} could not be written. ${summary.errors[0] ?? ""}`.trim(),
      );
      set({ progress: null });
      await get().skip();
    } catch (cause) {
      // The dialog stays on this release so the mapping can be corrected
      // rather than searched for again.
      set({ stage: "confirm", progress: null, error: String(cause) });
    }
  },

  watch: async () => {
    // Guarded on the stage, unlike the editor's: `tags://progress` is one
    // channel for every tag write, and a save started from the tag editor
    // would otherwise move this dialog's readout.
    return onTagWriteProgress((progress) => {
      if (get().stage === "applying") {
        set({ progress });
      }
    });
  },
}));
