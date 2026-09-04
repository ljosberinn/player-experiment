import { create } from "zustand";
import {
  INVALIDATE_DEBOUNCE_MS,
  onLibraryChanged,
  onTagWriteProgress,
  type ReleaseCandidate,
  type ReleaseDetail,
  type ReleaseSelection,
  type ReviewEntry,
  type Track,
  type TrackEdit,
  tagsourceApply,
  tagsourceFetch,
  tagsourceGroups,
  tagsourceRestoreReview,
  tagsourceReviewCounts,
  tagsourceReviewQueue,
  tagsourceSearch,
  tagsourceSetAside,
  tracksByIds,
  type WriteProgress,
} from "../../ipc";
import { debounce } from "../../lib/debounce";
import { dismiss, notify, report } from "../shell/statusStore";
import { allFields, type Fields, identityOf } from "./mapping";

/**
 * What the dialog is doing about the release it is on.
 *
 * A release at a time, in a queue, because that is the unit a lookup costs a
 * request at: a folder-wide selection is dozens of releases, and the limiter
 * lets one request out every ten seconds. The queue is what lets that
 * selection be tagged in one pass without pretending it is one release.
 *
 * `opening` is reading the release's files, which is a local query and is over
 * in a moment. It is its own stage rather than part of `searching` because the
 * review queue arrives with its candidates already found: those entries pass
 * through here and never reach `searching` at all.
 */
export type Stage = "opening" | "searching" | "results" | "fetching" | "confirm" | "applying";

interface TagsourceState {
  /** The releases still to work through, or null when the dialog is closed. */
  queue: ReviewEntry[] | null;
  /** Which of them is on screen. */
  index: number;
  /**
   * Whether this queue came from the review queue rather than a selection.
   *
   * Only what the pass queued can be set aside, so it is the only queue the
   * dialog offers it on - elsewhere the button would do nothing.
   */
  fromReview: boolean;
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

  /** How many releases the pass could not write, for the sidebar's row. */
  review: number;
  /** How many were set aside, which is the size of the way back. */
  aside: number;

  /** Groups a selection into releases and opens the dialog on the first. */
  open: (trackIds: number[]) => Promise<void>;
  /** Opens the dialog on what the unattended pass could not write. */
  openReview: () => Promise<void>;
  close: () => void;
  /** Leaves this release alone for now and moves to the next, or closes. */
  skip: () => Promise<void>;
  /** Takes this release out of the queue for good, then moves on. */
  setAside: () => Promise<void>;
  /** Puts every set-aside release back in the queue. */
  restoreAside: () => Promise<void>;
  /** Re-reads the two counts. Called whenever the library changes. */
  loadCounts: () => Promise<void>;
  /** Keeps the two counts current; returns its own teardown. */
  watchCounts: () => Promise<() => void>;
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
function current(state: TagsourceState): ReviewEntry | null {
  return state.queue?.[state.index] ?? null;
}

/** A release the user picked out themselves, which arrives with no candidates. */
function unsearched(release: ReleaseSelection): ReviewEntry {
  return { ...release, candidates: null };
}

export const useTagsourceStore = create<TagsourceState>((set, get) => {
  /**
   * Reads the current release's files and gets it to a step the user can act
   * on.
   *
   * The two queues part company here. A selection has to be searched for; a
   * review entry was searched for when the pass queued it, and re-searching
   * four hundred of those is over an hour of waiting to click.
   */
  const enter = async () => {
    const entry = current(get());
    if (entry === null) {
      return;
    }
    set({ stage: "opening", candidates: [], detail: null, error: null, tracks: [] });
    try {
      // Fetched rather than read from the page cache: the selection can name
      // rows a scroll has evicted, and the mapping is about to be built out of
      // their track numbers.
      const tracks = await tracksByIds(entry.trackIds);
      if (current(get()) !== entry) {
        return;
      }
      set({ tracks });
    } catch (cause) {
      set({ stage: "results", error: String(cause) });
      return;
    }

    if (entry.candidates === null) {
      await get().search();
      return;
    }
    set({ candidates: entry.candidates, stage: "results" });
  };

  /** Moves to `next`, or closes the dialog if the queue is past its end. */
  const advance = async (next: number) => {
    if (next >= (get().queue?.length ?? 0)) {
      get().close();
      return;
    }
    set({ index: next });
    await enter();
  };

  return {
    queue: null,
    index: 0,
    fromReview: false,
    tracks: [],
    stage: "opening",
    candidates: [],
    detail: null,
    fields: allFields(),
    progress: null,
    error: null,
    review: 0,
    aside: 0,

    open: async (trackIds) => {
      if (trackIds.length === 0) {
        return;
      }
      dismiss();
      try {
        const groups = await tagsourceGroups(trackIds);
        if (groups.length === 0) {
          return;
        }
        set({ queue: groups.map(unsearched), index: 0, fromReview: false, fields: allFields() });
        await enter();
      } catch (cause) {
        report(cause);
      }
    },

    openReview: async () => {
      dismiss();
      try {
        const queue = await tagsourceReviewQueue();
        // Opening the queue prunes rows whose release has since been retagged
        // or removed, so its length is a better answer than the count the row
        // was drawn with.
        set({ review: queue.length });
        if (queue.length === 0) {
          return;
        }
        set({ queue, index: 0, fromReview: true, fields: allFields() });
        await enter();
      } catch (cause) {
        report(cause);
      }
    },

    close: () =>
      set({ queue: null, tracks: [], candidates: [], detail: null, error: null, index: 0 }),

    skip: () => advance(get().index + 1),

    setAside: async () => {
      const entry = current(get());
      if (entry === null) {
        return;
      }
      try {
        await tagsourceSetAside(entry.album, entry.artist);
      } catch (cause) {
        // Said on the release it failed for, and the queue stays where it is:
        // moving on would look like the release had been set aside.
        set({ error: String(cause) });
        return;
      }
      await advance(get().index + 1);
    },

    restoreAside: async () => {
      try {
        const restored = await tagsourceRestoreReview();
        notify(`${restored} release${restored === 1 ? "" : "s"} back in the review queue.`);
      } catch (cause) {
        report(cause);
      }
    },

    loadCounts: async () => {
      try {
        const { review, aside } = await tagsourceReviewCounts();
        set({ review, aside });
      } catch {
        // The row simply keeps the numbers it had; the next change re-asks.
      }
    },

    search: async () => {
      const entry = current(get());
      if (entry === null) {
        return;
      }
      set({ stage: "searching", candidates: [], detail: null, error: null });
      try {
        const candidates = await tagsourceSearch(entry.album, entry.artist);
        // Guard against a queue that moved on while the request was in flight -
        // Skip is one click and a search is a rate-limited ten seconds.
        if (current(get()) !== entry) {
          return;
        }
        set({ candidates, stage: "results" });
      } catch (cause) {
        set({ stage: "results", error: String(cause) });
      }
    },

    pick: async (mbid) => {
      const entry = current(get());
      if (entry === null) {
        return;
      }
      set({ stage: "fetching", error: null });
      try {
        const detail = await tagsourceFetch(mbid, entry.album, entry.artist);
        if (current(get()) !== entry) {
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
      const entry = current(get());
      const detail = get().detail;
      if (entry === null || detail === null) {
        return;
      }
      // Set here rather than on the first event, so the dialog goes to work the
      // moment Apply is pressed instead of when the first file lands.
      set({ stage: "applying", progress: { done: 0, total: edits.length }, error: null });
      try {
        const summary = await tagsourceApply(edits, identityOf(entry, detail));
        notify(
          summary.failed === 0
            ? `Tagged ${summary.written} song${summary.written === 1 ? "" : "s"} from MusicBrainz.`
            : `Tagged ${summary.written}; ${summary.failed} could not be written. ${summary.errors[0] ?? ""}`.trim(),
        );
        set({ progress: null });
        // The apply is also what takes the release out of the review queue: it
        // records the identity it wrote, so the count comes down over
        // `library://changed` rather than being adjusted here.
        await advance(get().index + 1);
      } catch (cause) {
        // The dialog stays on this release so the mapping can be corrected
        // rather than searched for again.
        set({ stage: "confirm", progress: null, error: String(cause) });
      }
    },

    watchCounts: async () => {
      // The pass says `library://changed` per release it queues as well as per
      // release it writes, so this is what the sidebar's count moves on over
      // the hours a pass runs for. Debounced around the event, like every
      // other subscriber to it.
      const recount = debounce(() => void get().loadCounts(), INVALIDATE_DEBOUNCE_MS);
      const off = await onLibraryChanged(recount);
      return () => {
        recount.cancel();
        off();
      };
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
  };
});
