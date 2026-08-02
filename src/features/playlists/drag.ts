/**
 * The drag payload for track rows.
 *
 * Ids travel as JSON under a private MIME type rather than as `text/plain`, so
 * a drag from the songs table cannot be dropped into a text field somewhere
 * and a paste of arbitrary text cannot be mistaken for a track drag.
 */
export const TRACK_IDS_MIME = "application/x-player-track-ids";

/** The parts of `DataTransfer` this module needs, so tests can hand it a stub. */
export interface DragData {
  setData: (format: string, data: string) => void;
  getData: (format: string) => string;
  readonly types: readonly string[];
}

export function setTrackIds(data: DragData, trackIds: readonly number[]): void {
  data.setData(TRACK_IDS_MIME, JSON.stringify(trackIds));
}

/**
 * Reads the dragged ids back, or an empty array for anything else.
 *
 * A drop handler sees payloads it never created - a file from Explorer, a URL
 * from a browser - so a malformed or absent payload has to be "not ours"
 * rather than an exception.
 */
export function readTrackIds(data: DragData): number[] {
  try {
    const parsed: unknown = JSON.parse(data.getData(TRACK_IDS_MIME));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is number => typeof id === "number" && Number.isFinite(id));
  } catch {
    return [];
  }
}

/**
 * Whether a drag in progress is one of ours.
 *
 * `dragover` cannot read the payload - the browser only exposes the *types*
 * until the drop - so deciding whether to accept a drag has to go through this
 * rather than through {@link readTrackIds}.
 */
export function hasTrackIds(data: Pick<DragData, "types">): boolean {
  return Array.from(data.types).includes(TRACK_IDS_MIME);
}

/**
 * Turns a pointer position inside a row into an insertion index.
 *
 * Dropping on the upper half of a row means "above this one", on the lower
 * half "below it" - the same convention every list with drag-reorder uses, and
 * the only way to express "after the last row".
 */
export function dropIndexFor(rowIndex: number, offsetY: number, rowHeight: number): number {
  return offsetY >= rowHeight / 2 ? rowIndex + 1 : rowIndex;
}

/**
 * The badge shown under the pointer while rows are being dragged.
 *
 * The default drag image is a translucent screenshot of the row, which for a
 * full-width table row is a wide smear of page - unmistakably a web drag. Every
 * desktop music player instead shows a small count, because what is being
 * carried is "seven songs", not a rectangle of the screen.
 *
 * Returns a cleanup function: the element has to be in the document for the
 * browser to rasterize it, and has to be gone by the next frame.
 */
export function setDragImage(
  event: { dataTransfer: { setDragImage?: (image: Element, x: number, y: number) => void } },
  count: number,
): () => void {
  const badge = document.createElement("div");
  badge.className = "drag-badge";
  badge.textContent = `${count} song${count === 1 ? "" : "s"}`;
  // Off-screen rather than hidden: `display: none` and `visibility: hidden`
  // both make it unrasterizable, so it would silently do nothing.
  badge.style.position = "fixed";
  badge.style.top = "-1000px";
  badge.style.left = "-1000px";
  document.body.appendChild(badge);
  event.dataTransfer.setDragImage?.(badge, 12, 12);
  return () => badge.remove();
}
