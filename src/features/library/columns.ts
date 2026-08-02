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
  { id: "title", label: "Name", width: 280, render: (t) => t.title ?? fileName(t.path) },
  {
    id: "durationMs",
    label: "Time",
    width: 64,
    align: "right",
    render: (t) => formatDuration(t.duration_ms),
  },
  { id: "artist", label: "Artist", width: 180, render: (t) => t.artist ?? "" },
  { id: "album", label: "Album", width: 180, render: (t) => t.album ?? "" },
  { id: "genre", label: "Genre", width: 130, render: (t) => t.genre ?? "" },
  { id: "year", label: "Year", width: 60, align: "right", render: (t) => t.year?.toString() ?? "" },
  {
    id: "trackNo",
    label: "#",
    width: 44,
    align: "right",
    render: (t) => t.track_no?.toString() ?? "",
  },
  { id: "albumArtist", label: "Album Artist", width: 180, render: (t) => t.album_artist ?? "" },
  {
    id: "playCount",
    label: "Plays",
    width: 60,
    align: "right",
    render: (t) => t.play_count.toString(),
  },
  { id: "path", label: "Location", width: 320, render: (t) => t.path },
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
