import type { ListenQuery, Playlist, TimeRange, TrackQuery } from "../../ipc";
import type { StatsCrumb, StatsPath, StatsTab } from "./path";
import { periodSpan } from "./series";

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

/** A day in seconds. `custom.to` is exclusive, so reading it back is one of these. */
export const DAY = 86_400;

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

/** One filter the token line draws, and what its × puts back. */
export interface ActiveFilter {
  readonly facet: "range" | "owned" | "loved" | "scope" | "genre";
  /** Reads as the continuation of "Showing …". */
  readonly phrase: string;
  readonly cleared: Partial<StatsFilters>;
}

/**
 * The filters that are narrowing the open tab, in the order the bar draws them.
 *
 * A facet at its default is not one: the token line says what is filtered, and
 * a token per facet regardless would be the select bar again with worse copy.
 *
 * The phrases are their own wording rather than the selects' option labels. A
 * select answers a caption - Owned: "In the library" - and a token continues a
 * sentence - Showing "owned only". Range is the exception, because a lower-case
 * `RANGE_TITLES` is already the sentence form.
 *
 * Takes the playlists rather than reading them, for the reason `libraryQuery`
 * takes the view: the caller subscribes, and a pure function of both is what
 * the tests can drive.
 */
export function activeFilters(
  filters: StatsFilters,
  tab: StatsTab,
  playlists: readonly Playlist[],
): readonly ActiveFilter[] {
  const active: ActiveFilter[] = [];

  if (tab === "listening") {
    // `custom` before both dates are picked narrows nothing - `rangeFor`
    // returns null for it - so there is no filter to draw.
    if (filters.range !== "all" && (filters.range !== "custom" || filters.custom !== null)) {
      active.push({
        facet: "range",
        phrase: rangePhrase(filters),
        cleared: { range: DEFAULT_FILTERS.range, custom: null },
      });
    }
    if (filters.owned !== null) {
      active.push({
        facet: "owned",
        phrase: filters.owned ? "owned only" : "not owned",
        cleared: { owned: null },
      });
    }
    if (filters.loved !== null) {
      active.push({
        facet: "loved",
        phrase: filters.loved ? "loved only" : "not loved",
        cleared: { loved: null },
      });
    }
    return active;
  }

  if (filters.scope.kind !== "library") {
    active.push({
      facet: "scope",
      phrase: scopePhrase(filters.scope, playlists),
      cleared: { scope: DEFAULT_FILTERS.scope },
    });
  }
  if (filters.genre !== null) {
    // The genre as the library spells it: it is the library's own word, and a
    // token that lower-cased it would be naming something else.
    active.push({ facet: "genre", phrase: filters.genre, cleared: { genre: null } });
  }
  return active;
}

function rangePhrase(filters: StatsFilters): string {
  if (filters.range !== "custom" || filters.custom === null) {
    return RANGE_TITLES[filters.range].toLowerCase();
  }
  // The stored upper bound is the start of the day after the one that was
  // picked, which is the day the field shows.
  return `${localDay(filters.custom.from)} – ${localDay(filters.custom.to - DAY)}`;
}

function scopePhrase(
  scope: Exclude<StatsScope, { kind: "library" }>,
  playlists: readonly Playlist[],
): string {
  if (scope.kind === "view") {
    return "the current view";
  }
  return playlists.find((playlist) => playlist.id === scope.playlistId)?.name ?? "the playlist";
}

function localDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

/**
 * What the Listening tab asks for.
 *
 * The drill path narrows it: a crumb is the thing that was clicked, and one of
 * each kind is all `ListenQuery` can express - drilling into an artist and then
 * one of their albums is two crumbs and two fields, and a second artist crumb
 * replaces the first rather than contradicting it.
 *
 * A period is the exception, and intersects the range and every period above
 * it instead. A week opens on its Monday, so the first bar under 2023 is keyed
 * in 2022 but counted from January; replacing the range with its span would
 * drill into days the bar never counted. Intersections that miss each other -
 * a range changed after drilling - come out empty, and so does the answer.
 */
export function listenQuery(filters: StatsFilters, path: StatsPath | null, now: Date): ListenQuery {
  let range = rangeFor(filters, now);
  for (const crumb of path?.crumbs ?? []) {
    if (crumb.kind === "period") {
      const span = periodSpan(crumb.key);
      range =
        range === null
          ? span
          : { from: Math.max(range.from, span.from), to: Math.min(range.to, span.to) };
    }
  }

  return {
    range,
    artist: deepestCrumb(path, "artist"),
    genre: deepestCrumb(path, "genre"),
    album: deepestCrumb(path, "album"),
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
 *
 * The drill path narrows it the way it narrows the Listening tab. Genre is the
 * only kind the Library tab drills today, and the deepest one wins - a crumb
 * three levels down is where the view is, and the two above it are how it got
 * there.
 */
export function libraryQuery(
  filters: StatsFilters,
  view: Pick<TrackQuery, "search" | "playlistId" | "browse">,
  path: StatsPath | null = null,
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
    // The facet and the crumb are one slot and one meaning: a branch of the
    // genre tree, matching what a genre crumb means on the Listening tab.
    // Through `genre` rather than `browse` because the two are different
    // questions - `browse` is an exact tag, so a resolved label like `popular
    // music`, which no file is tagged with, would match nothing there.
    //
    // It composes with the view's drill-in rather than replacing it. One genre
    // of an album that is not in it returns nothing, which is the state a
    // search that matched nothing already puts every panel in.
    genre: deepestCrumb(path, "genre") ?? filters.genre,
    // Totals read neither, and the type carries both because one query type
    // serves the table as well.
    sortBy: "artist",
    direction: "asc",
    offset: 0,
    limit: 0,
  };
}

/**
 * The last crumb of `kind` on the path, which is where the view is pointed.
 *
 * Deepest rather than first: drilling into a genre and then one of its
 * children is two crumbs of the same kind and one filter, and the second is
 * the answer. Both tabs narrow this way, so both read it from here.
 */
export function deepestCrumb(path: StatsPath | null, kind: StatsCrumb["kind"]): string | null {
  const crumbs = path?.crumbs ?? [];
  for (let index = crumbs.length - 1; index >= 0; index -= 1) {
    const crumb = crumbs[index];
    if (crumb !== undefined && crumb.kind === kind) {
      return crumb.key;
    }
  }
  return null;
}
