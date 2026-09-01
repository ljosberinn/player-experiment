import type { SortField, Track } from "../../ipc";
import { formatDuration } from "../../lib/format";

export interface ColumnDef {
  id: SortField;
  label: string;
  width: number;
  align?: "right";
  render: (track: Track) => string;
}

/**
 * Column ids are `SortField`s, so every displayed column is sortable by
 * construction - a column can't exist that the backend cannot order by.
 */
export const ALL_COLUMNS: ColumnDef[] = [
  { id: "title", label: "Name", width: 336, render: (t) => t.title ?? fileName(t.path) },
  {
    id: "durationMs",
    label: "Time",
    width: 77,
    align: "right",
    render: (t) => formatDuration(t.duration_ms),
  },
  { id: "artist", label: "Artist", width: 216, render: (t) => t.artist ?? "" },
  { id: "album", label: "Album", width: 216, render: (t) => t.album ?? "" },
  { id: "genre", label: "Genre", width: 156, render: (t) => t.genre ?? "" },
  { id: "year", label: "Year", width: 72, align: "right", render: (t) => t.year?.toString() ?? "" },
  {
    id: "trackNo",
    label: "#",
    width: 53,
    align: "right",
    render: (t) => t.track_no?.toString() ?? "",
  },
  { id: "albumArtist", label: "Album Artist", width: 216, render: (t) => t.album_artist ?? "" },
  {
    id: "playCount",
    label: "Plays",
    width: 72,
    align: "right",
    render: (t) => t.play_count.toString(),
  },
  { id: "path", label: "Location", width: 384, render: (t) => t.path },
];

export const DEFAULT_COLUMN_IDS: SortField[] = ["title", "durationMs", "artist", "album", "genre"];

export function columnsFor(ids: SortField[]): ColumnDef[] {
  // Driven by `ids` rather than filtering ALL_COLUMNS, so the user's column
  // order is preserved rather than snapping back to the declaration order.
  return ids
    .map((id) => ALL_COLUMNS.find((column) => column.id === id))
    .filter((column): column is ColumnDef => column !== undefined);
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * The smallest a column may be dragged.
 *
 * Not zero: a column dragged to nothing is indistinguishable from one that was
 * hidden, except that there is no way to grab it again.
 */
export const MIN_COLUMN_WIDTH = 48;

/**
 * Which columns a view shows, in what order, at what widths.
 *
 * Widths are a sparse override rather than a full map, so a column left alone
 * keeps following its default in `ALL_COLUMNS` instead of freezing whatever it
 * happened to be when the config was first written.
 */
export interface ColumnConfig {
  ids: SortField[];
  widths: Partial<Record<SortField, number>>;
}

export const DEFAULT_COLUMN_CONFIG: ColumnConfig = {
  ids: DEFAULT_COLUMN_IDS,
  widths: {},
};

/**
 * Widths measured off what is on screen, held apart from `ColumnConfig`.
 *
 * Transient by construction: recomputed on the next navigation and never
 * saved, so a playlist that has grown since its last visit is fitted again
 * rather than keeping the answer from its first.
 */
export type FittedWidths = Partial<Record<SortField, number>>;

/**
 * The columns to render, with any stored width applied and any fitted width
 * filling in behind it.
 *
 * A stored width wins: `resizeColumn` persists one per view, and a fit
 * painting over it would leave the stored number with no way to be seen.
 */
export function resolveColumns(config: ColumnConfig, fitted: FittedWidths = {}): ColumnDef[] {
  return columnsFor(config.ids).map((column) => {
    const width = config.widths[column.id] ?? fitted[column.id];
    return width === undefined ? column : { ...column, width };
  });
}

/**
 * Shows or hides one column.
 *
 * Hiding preserves the order of the rest; showing appends, because there is no
 * better answer - the column's declaration order says nothing about where the
 * user wants it, and they can drag it.
 *
 * Hiding the last visible column is refused. An empty table has no headers,
 * which means no header menu, which means no way back.
 */
export function toggleColumn(config: ColumnConfig, id: SortField): ColumnConfig {
  if (!config.ids.includes(id)) {
    return { ...config, ids: [...config.ids, id] };
  }
  if (config.ids.length === 1) {
    return config;
  }
  return { ...config, ids: config.ids.filter((existing) => existing !== id) };
}

/** Moves a column to `toIndex`, counted in the order after removal. */
export function moveColumn(config: ColumnConfig, id: SortField, toIndex: number): ColumnConfig {
  const from = config.ids.indexOf(id);
  if (from === -1) {
    return config;
  }
  const without = config.ids.filter((existing) => existing !== id);
  const clamped = Math.max(0, Math.min(toIndex, without.length));
  return { ...config, ids: [...without.slice(0, clamped), id, ...without.slice(clamped)] };
}

export function resizeColumn(config: ColumnConfig, id: SortField, width: number): ColumnConfig {
  return {
    ...config,
    widths: { ...config.widths, [id]: Math.max(MIN_COLUMN_WIDTH, Math.round(width)) },
  };
}

/**
 * The sort to use given a config, falling back when the sorted column is not
 * on screen.
 *
 * A view sorted by a column nobody can see looks like it is in no order at
 * all, and there is no header to click to fix it. `relevance` and `position`
 * are exempt: they are properties of the query rather than of a column, and
 * have no header either way.
 */
export function visibleSort(config: ColumnConfig, sortBy: SortField): SortField {
  if (sortBy === "relevance" || sortBy === "position" || config.ids.includes(sortBy)) {
    return sortBy;
  }
  return config.ids[0] ?? "title";
}

/**
 * Reads a stored config, tolerating anything.
 *
 * This parses data written by an older version of the app, so it cannot assume
 * shape: unknown column ids are dropped rather than rendering as blanks, and
 * anything unparseable falls back to the defaults. A corrupt row must not make
 * the table unusable.
 */
export function parseColumnConfig(json: string | null): ColumnConfig {
  if (json === null) {
    return DEFAULT_COLUMN_CONFIG;
  }
  try {
    const raw: unknown = JSON.parse(json);
    if (typeof raw !== "object" || raw === null) {
      return DEFAULT_COLUMN_CONFIG;
    }
    const { ids, widths } = raw as { ids?: unknown; widths?: unknown };
    const known = new Set(ALL_COLUMNS.map((column) => column.id));
    const parsedIds = Array.isArray(ids)
      ? ids.filter((id): id is SortField => typeof id === "string" && known.has(id as SortField))
      : [];
    // Every column gone is the same unusable table `toggleColumn` refuses to
    // produce, so a config that arrives that way is treated as absent.
    if (parsedIds.length === 0) {
      return DEFAULT_COLUMN_CONFIG;
    }
    const parsedWidths: Partial<Record<SortField, number>> = {};
    if (typeof widths === "object" && widths !== null) {
      for (const [id, width] of Object.entries(widths)) {
        if (known.has(id as SortField) && typeof width === "number" && Number.isFinite(width)) {
          parsedWidths[id as SortField] = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
        }
      }
    }
    // Duplicates would render one column twice and break React keys.
    return { ids: [...new Set(parsedIds)], widths: parsedWidths };
  } catch {
    return DEFAULT_COLUMN_CONFIG;
  }
}

export function serializeColumnConfig(config: ColumnConfig): string {
  return JSON.stringify(config);
}
