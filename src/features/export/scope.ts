import type { ExportScope } from "../../ipc";

/**
 * What an export covers, and what to call it.
 *
 * Derived from the view rather than asked in a dialog: the user has already
 * expressed what they mean by selecting rows or opening a playlist, and a
 * second question about it would be asking them to say it twice. The button
 * says which, so it is never a guess they have to verify afterwards.
 */
export interface ExportChoice {
  scope: ExportScope;
  /** What the button reads, e.g. "Export 12 Songs…". */
  label: string;
  /** The name the save dialog suggests. */
  fileName: string;
}

export function exportChoice(
  selectedIds: readonly number[],
  playlist: { id: number; name: string } | null,
): ExportChoice {
  if (selectedIds.length > 0) {
    return {
      scope: { kind: "selection", trackIds: [...selectedIds] },
      label: `Export ${selectedIds.length} Song${selectedIds.length === 1 ? "" : "s"}…`,
      fileName: "player-selection.json",
    };
  }
  if (playlist !== null) {
    return {
      scope: { kind: "playlist", playlistId: playlist.id },
      label: `Export ${playlist.name}…`,
      fileName: `${safeFileName(playlist.name)}.json`,
    };
  }
  return {
    scope: { kind: "library" },
    label: "Export Library…",
    fileName: "player-library.json",
  };
}

/**
 * Makes a playlist name usable as a file name.
 *
 * A playlist called `AC/DC: B-Sides?` is perfectly reasonable and completely
 * unusable as a Windows file name, so the characters the OS refuses become
 * hyphens rather than an error the user has to decode. Spaces are left alone -
 * they are legal, and replacing them would be tidying, not fixing.
 */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*]/g, "-")
    // Trailing dots and spaces are legal to type and illegal to store.
    .replace(/[. ]+$/, "")
    .trim();
  return cleaned === "" ? "playlist" : cleaned;
}
