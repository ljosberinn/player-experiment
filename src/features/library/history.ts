import type { BrowseFilter } from "../../ipc";
import type { ViewTab } from "./store";

/**
 * Where the user is, as one value.
 *
 * The three fields the library store writes when the view changes, and nothing
 * else. Selection is deliberately out: going back to an album and finding a
 * different row highlighted is worse than going back and finding the album.
 * So is `search` - it changes per keystroke, and a hundred entries per typed
 * query is not history.
 */
export interface HistoryEntry {
  readonly tab: ViewTab;
  readonly browse: BrowseFilter | null;
  readonly playlistId: number | null;
}

/** A list and an index into it. Everything behind the index is back. */
export interface History {
  readonly entries: readonly HistoryEntry[];
  /** Which entry is on screen; -1 only once every entry has been forgotten. */
  readonly index: number;
}

export const emptyHistory: History = { entries: [], index: -1 };

/** A history holding one entry - the view the app opened in. */
export function historyAt(entry: HistoryEntry): History {
  return { entries: [entry], index: 0 };
}

export function sameView(a: HistoryEntry, b: HistoryEntry): boolean {
  return (
    a.tab === b.tab &&
    a.playlistId === b.playlistId &&
    a.browse?.kind === b.browse?.kind &&
    (a.browse?.key ?? null) === (b.browse?.key ?? null) &&
    (a.browse?.secondary ?? null) === (b.browse?.secondary ?? null)
  );
}

export function currentEntry(history: History): HistoryEntry | null {
  return history.entries[history.index] ?? null;
}

/** Where back would land, or null when there is nothing behind. */
export function backEntry(history: History): HistoryEntry | null {
  return history.entries[history.index - 1] ?? null;
}

export function forwardEntry(history: History): HistoryEntry | null {
  return history.entries[history.index + 1] ?? null;
}

/**
 * Appends `entry`, dropping anything ahead of the index.
 *
 * Navigating after going back abandons the forward branch, the way every
 * browser does it: there is one future and the user just chose a different one.
 */
export function record(history: History, entry: HistoryEntry): History {
  const current = currentEntry(history);
  if (current !== null && sameView(current, entry)) {
    return history;
  }
  const entries = [...history.entries.slice(0, history.index + 1), entry];
  return { entries, index: entries.length - 1 };
}

export function goBack(history: History): History | null {
  return backEntry(history) === null ? null : { ...history, index: history.index - 1 };
}

export function goForward(history: History): History | null {
  return forwardEntry(history) === null ? null : { ...history, index: history.index + 1 };
}

/**
 * Drops every entry belonging to a playlist that no longer exists.
 *
 * The index follows the entries rather than being clamped afterwards: it has
 * to keep pointing at the same view, or at the nearest surviving one behind
 * it, so that back does not land on something gone.
 */
export function forgetPlaylist(history: History, playlistId: number): History {
  const entries: HistoryEntry[] = [];
  let index = -1;
  history.entries.forEach((entry, position) => {
    if (entry.playlistId === playlistId) {
      return;
    }
    entries.push(entry);
    if (position <= history.index) {
      index = entries.length - 1;
    }
  });
  return { entries, index };
}

/**
 * Drops every entry pointing at exactly the group that just emptied.
 *
 * Narrower than `forgetPlaylist`: a playlist takes every entry behind it, but
 * only the one drill-in died here, so a different group in the same tab must
 * survive.
 */
export function forgetGroup(history: History, dead: HistoryEntry): History {
  const entries: HistoryEntry[] = [];
  let index = -1;
  history.entries.forEach((entry, position) => {
    if (sameView(entry, dead)) {
      return;
    }
    entries.push(entry);
    if (position <= history.index) {
      index = entries.length - 1;
    }
  });
  return { entries, index };
}
