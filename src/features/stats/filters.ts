import type { ListenQuery, TimeRange, TrackQuery } from "../../ipc";
import type { StatsPath } from "./path";

/**
 * What the filter bar can be set to, for both tabs at once.
 *
 * One object rather than one per tab: it is stored as one opaque value, and a
 * filter that only one tab draws is still a filter that tab should find where
 * it left it.
 */
export interface StatsFilters {
  readonly range: RangeId;
  /** The span behind `range: "custom"`; ignored under every other id. */
  readonly custom: TimeRange | null;
  /** Listening: plays matched to a file, unmatched ones, or both. */
  readonly owned: boolean | null;
  readonly loved: boolean | null;
  /** Library: what the aggregates count. */
  readonly scope: StatsScope;
  /** Library: one genre, through `browse`, which is where genre filtering is. */
  readonly genre: string | null;
}

export type RangeId = "all" | "thisYear" | "months12" | "thisMonth" | "days7" | "custom";

export const RANGE_TITLES: Record<RangeId, string> = {
  all: "All time",
  thisYear: "This year",
  months12: "Last 12 months",
  thisMonth: "This month",
  days7: "Last 7 days",
  custom: "Custom…",
};

/**
 * Which tracks the Library tab counts.
 *
 * `view` is the library's own query - its search, its playlist, its drill-in -
 * so the tab can answer "what am I looking at" without restating it here.
 */
export type StatsScope =
  | { readonly kind: "library" }
  | { readonly kind: "view" }
  | { readonly kind: "playlist"; readonly playlistId: number };

export const DEFAULT_FILTERS: StatsFilters = {
  range: "all",
  custom: null,
  owned: null,
  loved: null,
  scope: { kind: "library" },
  genre: null,
};

/**
 * Reads back what `serializeFilters` wrote, field by field.
 *
 * Tolerant for the reason `parseColumnConfig` is: the value is whatever the
 * last version of the app stored, and a filter bar that refuses to open
 * because one key changed shape would be worse than one that opens on the
 * defaults.
 */
export function parseFilters(stored: string | null): StatsFilters {
  if (stored === null) {
    return DEFAULT_FILTERS;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return DEFAULT_FILTERS;
  }
  if (typeof raw !== "object" || raw === null) {
    return DEFAULT_FILTERS;
  }
  const value = raw as Record<string, unknown>;
  return {
    range: isRangeId(value.range) ? value.range : DEFAULT_FILTERS.range,
    custom: parseRange(value.custom),
    owned: typeof value.owned === "boolean" ? value.owned : null,
    loved: typeof value.loved === "boolean" ? value.loved : null,
    scope: parseScope(value.scope),
    genre: typeof value.genre === "string" && value.genre !== "" ? value.genre : null,
  };
}

export function serializeFilters(filters: StatsFilters): string {
  return JSON.stringify(filters);
}

function isRangeId(value: unknown): value is RangeId {
  return typeof value === "string" && value in RANGE_TITLES;
}

function parseRange(value: unknown): TimeRange | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { from, to } = value as Record<string, unknown>;
  if (typeof from !== "number" || typeof to !== "number" || to <= from) {
    return null;
  }
  return { from, to };
}

function parseScope(value: unknown): StatsScope {
  if (typeof value !== "object" || value === null) {
    return DEFAULT_FILTERS.scope;
  }
  const { kind, playlistId } = value as Record<string, unknown>;
  if (kind === "view") {
    return { kind: "view" };
  }
  if (kind === "playlist" && typeof playlistId === "number") {
    return { kind: "playlist", playlistId };
  }
  return { kind: "library" };
}

/**
 * The span a range id stands for, in unix seconds, or null for all time.
 *
 * Built in local time and taking `now`, for the two reasons the query layer
 * gives: its buckets are local days, and a range derived from the clock is
 * otherwise untestable. The upper bound is the start of tomorrow rather than
 * this instant, so a play later today is inside "this month".
 */
export function rangeFor(filters: StatsFilters, now: Date): TimeRange | null {
  if (filters.range === "all") {
    return null;
  }
  if (filters.range === "custom") {
    return filters.custom;
  }
  const to = seconds(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  switch (filters.range) {
    case "thisYear":
      return { from: seconds(new Date(now.getFullYear(), 0, 1)), to };
    case "months12":
      return { from: seconds(new Date(now.getFullYear(), now.getMonth() - 12, now.getDate())), to };
    case "thisMonth":
      return { from: seconds(new Date(now.getFullYear(), now.getMonth(), 1)), to };
    case "days7":
      return { from: seconds(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), to };
  }
}

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** The date an `<input type="date">` shows for a bound, in local time. */
export function dateInputValue(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The second a date input's value starts at, local, or null while it is empty. */
export function dateInputSeconds(value: string): number | null {
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined || Number.isNaN(year)) {
    return null;
  }
  return seconds(new Date(year, month - 1, day));
}

/**
 * What the Listening tab asks for.
 *
 * The drill path narrows it: a crumb is the thing that was clicked, and one of
 * each kind is all `ListenQuery` can express - drilling into an artist and then
 * one of their albums is two crumbs and two fields, and a second artist crumb
 * replaces the first rather than contradicting it.
 */
export function listenQuery(filters: StatsFilters, path: StatsPath | null, now: Date): ListenQuery {
  const crumb = (kind: "artist" | "genre" | "album") => {
    const steps = path?.crumbs ?? [];
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      const step = steps[index];
      if (step !== undefined && step.kind === kind) {
        return step.key;
      }
    }
    return null;
  };

  return {
    range: rangeFor(filters, now),
    artist: crumb("artist"),
    genre: crumb("genre"),
    album: crumb("album"),
    owned: filters.owned,
    loved: filters.loved,
  };
}

/**
 * What the Library tab asks for.
 *
 * `view` takes the library's query as it stands, which is why this is given
 * one rather than reading the store: the caller subscribes, and a pure
 * function of both is what the tests can drive.
 */
export function libraryQuery(
  filters: StatsFilters,
  view: Pick<TrackQuery, "search" | "playlistId" | "browse">,
): TrackQuery {
  const scoped: Pick<TrackQuery, "search" | "playlistId" | "browse"> =
    filters.scope.kind === "view"
      ? view
      : {
          search: null,
          playlistId: filters.scope.kind === "playlist" ? filters.scope.playlistId : null,
          browse: null,
        };

  return {
    ...scoped,
    // One `browse` slot, so the facet replaces the view's drill-in rather than
    // narrowing it: asking for one genre of an album that is not in it would
    // have no answer to give.
    browse:
      filters.genre === null
        ? scoped.browse
        : { kind: "genres", key: filters.genre, secondary: null },
    // Totals read neither, and the type carries both because one query type
    // serves the table as well.
    sortBy: "artist",
    direction: "asc",
    offset: 0,
    limit: 0,
  };
}
