import type { BrowseFilter, BrowseKind } from "../../ipc";
import { STATS_TAB_TITLES, type StatsCrumb, type StatsPath, sameStatsPath } from "../stats/path";
import type { ViewTab } from "./store";

/**
 * Where the user is, as one value.
 *
 * The four fields the library store writes when the view changes, and nothing
 * else. Selection is deliberately out: going back to an album and finding a
 * different row highlighted is worse than going back and finding the album.
 * So is `search` - it changes per keystroke, and a hundred entries per typed
 * query is not history.
 */
export interface HistoryEntry {
  readonly tab: ViewTab;
  readonly browse: BrowseFilter | null;
  /**
   * What the open group is called, for the back button's tooltip.
   *
   * Beside the filter rather than in it, because the two are different things:
   * `BrowseFilter.id` is a release group MBID as often as it is a title, and a
   * tooltip reading a UUID is worse than no tooltip at all. Null both outside a
   * drill-in and inside an untagged one, where the label is the caller's
   * `unknownLabel`.
   */
  readonly browseLabel: string | null;
  readonly playlistId: number | null;
  /** Where Statistics is pointed, or null outside it. */
  readonly stats: StatsPath | null;
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

/**
 * `browseLabel` is deliberately out: two entries carrying one identity are one
 * view however each of them happened to be labelled.
 */
export function sameView(a: HistoryEntry, b: HistoryEntry): boolean {
  return (
    a.tab === b.tab &&
    a.playlistId === b.playlistId &&
    a.browse?.kind === b.browse?.kind &&
    (a.browse?.id ?? null) === (b.browse?.id ?? null) &&
    sameStatsPath(a.stats, b.stats)
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

export function serializeEntry(entry: HistoryEntry): string {
  return JSON.stringify(entry);
}

const BROWSE_KINDS: readonly string[] = ["albums", "artists", "genres"] satisfies BrowseKind[];
const CRUMB_KINDS: readonly string[] = [
  "artist",
  "genre",
  "album",
  "period",
] satisfies StatsCrumb["kind"][];

/**
 * The entry `stored` describes, or null for anything this app would not have
 * written - including one whose fields contradict each other, which no
 * navigation can reach and so no view can show.
 */
export function parseEntry(stored: string | null): HistoryEntry | null {
  if (stored === null) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const { tab, browse, browseLabel, playlistId, stats } = raw as Record<string, unknown>;
  if (
    typeof tab !== "string" ||
    (tab !== "songs" && tab !== "stats" && !BROWSE_KINDS.includes(tab))
  ) {
    return null;
  }
  if (browseLabel !== null && typeof browseLabel !== "string") {
    return null;
  }
  if (playlistId !== null && !Number.isInteger(playlistId)) {
    return null;
  }
  const filter = parseBrowse(browse);
  const path = parseStatsPath(stats);
  if (filter === undefined || path === undefined) {
    return null;
  }
  if (filter !== null && filter.kind !== tab) {
    return null;
  }
  if ((tab === "stats") !== (path !== null) || (tab === "stats" && playlistId !== null)) {
    return null;
  }
  return {
    tab: tab as ViewTab,
    browse: filter,
    browseLabel: browseLabel as string | null,
    playlistId: playlistId as number | null,
    stats: path,
  };
}

/** Undefined, as distinct from null, for a value that is neither. */
function parseBrowse(value: unknown): BrowseFilter | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const { kind, id } = value as Record<string, unknown>;
  if (typeof kind !== "string" || !BROWSE_KINDS.includes(kind)) {
    return undefined;
  }
  if (id !== null && typeof id !== "string") {
    return undefined;
  }
  return { kind: kind as BrowseKind, id };
}

function parseStatsPath(value: unknown): StatsPath | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const { tab, crumbs } = value as Record<string, unknown>;
  if (typeof tab !== "string" || !(tab in STATS_TAB_TITLES) || !Array.isArray(crumbs)) {
    return undefined;
  }
  const parsed: StatsCrumb[] = [];
  for (const crumb of crumbs as unknown[]) {
    if (typeof crumb !== "object" || crumb === null) {
      return undefined;
    }
    const { kind, key } = crumb as Record<string, unknown>;
    if (typeof kind !== "string" || !CRUMB_KINDS.includes(kind) || typeof key !== "string") {
      return undefined;
    }
    parsed.push({ kind: kind as StatsCrumb["kind"], key });
  }
  return { tab: tab as StatsPath["tab"], crumbs: parsed };
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
