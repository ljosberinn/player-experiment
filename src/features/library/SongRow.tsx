import type React from "react";
import type { Track } from "../../ipc";
import {
  dropIndexFor,
  hasTrackIds,
  readTrackIds,
  setDragImage,
  setTrackIds,
} from "../playlists/drag";
import type { ColumnDef } from "./columns";
import { RowStatusCell } from "./RowStatusCell";
import { isSelected } from "./selection";
import { useLibraryStore } from "./store";

export const ROW_HEIGHT = 26;

/** Where a reorder drop would land relative to this row, if it would. */
export type DropEdge = "before" | "after" | null;

/**
 * What a row can ask the table to do.
 *
 * One object rather than five props so the table has one thing to keep stable;
 * `SongTable` holds a virtualizer and so is not compiled, and builds this with
 * a hand-written `useMemo`.
 */
export interface RowActions {
  onActivate?: ((rowIndex: number) => void) | undefined;
  onReorder?: ((trackIds: number[], targetIndex: number) => void) | undefined;
  onRemove?: ((trackIds: number[]) => void) | undefined;
  onRemoveFromLibrary?: ((trackIds: number[]) => void) | undefined;
  /** What the row menu is about to act on, decided before the menu opens. */
  onContextMenu: (menu: { trackIds: number[]; rowIndex: number } | null) => void;
  setDropIndex: (index: number | null) => void;
}

/**
 * How far down the row the pointer is.
 *
 * Measured from the row rather than read off `offsetY`, which is relative to
 * whichever descendant the pointer happens to be over - a cell, not the row -
 * and so would put the halfway line in a different place per column.
 */
function offsetWithin(event: React.DragEvent<HTMLElement>): number {
  return event.clientY - event.currentTarget.getBoundingClientRect().top;
}

/**
 * One row of the song table, and the reason a scroll is not hundreds of
 * renders.
 *
 * Its own component so React Compiler caches its JSX per props: the table
 * holds a virtualizer and carries `"use no memo"`, so rows built as inline JSX
 * there were re-created - cells, handlers and all - on every render of the
 * body. A flick down a page cost thousands of cell renders.
 *
 * That puts the whole weight on prop stability, which is why every prop here
 * is a per-row fact rather than a piece of table state: `selected` and
 * `playing` rather than the selection and the playing id, `drop` rather than
 * the drop index. Passed raw, a dragover would invalidate every row in the
 * window instead of the one under the pointer.
 *
 * The selection is read through `getState()` where a handler needs it, for the
 * same reason the table's window keydown listener does - so a row subscribes
 * to nothing.
 */
export function SongRow({
  track,
  rowIndex,
  top,
  selected,
  playing,
  drop,
  columns,
  actions,
}: {
  /** Null while the page it belongs to is still in flight. */
  track: Track | null;
  rowIndex: number;
  /** Its offset in the virtualized body, in pixels. */
  top: number;
  selected: boolean;
  playing: boolean;
  drop: DropEdge;
  columns: ColumnDef[];
  actions: RowActions;
}) {
  const { onActivate, onReorder, onRemove, onRemoveFromLibrary, onContextMenu, setDropIndex } =
    actions;

  const select = (event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    if (track) {
      useLibraryStore.getState().clickRow(rowIndex, track.id, {
        shift: event.shiftKey,
        meta: event.ctrlKey || event.metaKey,
      });
    }
  };

  return (
    <tr
      aria-rowindex={rowIndex + 1}
      aria-selected={track ? selected : undefined}
      tabIndex={0}
      draggable={track !== null}
      className={[
        "song-row",
        rowIndex % 2 === 1 ? "odd" : "",
        selected ? "selected" : "",
        playing ? "playing" : "",
        track ? "" : "placeholder",
        drop === "before" ? "drop-before" : "",
        drop === "after" ? "drop-after" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ height: ROW_HEIGHT, transform: `translateY(${top}px)` }}
      onClick={select}
      onDoubleClick={() => onActivate?.(rowIndex)}
      onContextMenu={() => {
        // No preventDefault and no stopPropagation: the trigger on <tbody>
        // needs this event to reach it, and suppressing the webview's own menu
        // is its job now.
        if (!track) {
          onContextMenu(null);
          return;
        }
        // Right-clicking outside the selection acts on the row under the
        // pointer, the way every file manager does - otherwise the menu would
        // silently apply to rows scrolled off screen.
        const { selection, clickRow } = useLibraryStore.getState();
        const inSelection = isSelected(selection, track.id);
        if (!inSelection) {
          clickRow(rowIndex, track.id, {});
        }
        onContextMenu({
          trackIds: inSelection ? [...selection.ids] : [track.id],
          rowIndex,
        });
      }}
      onDragStart={(event) => {
        if (!track) {
          event.preventDefault();
          return;
        }
        // Dragging a row outside the selection makes that row the selection
        // first, so what moves is what the pointer grabbed rather than
        // something scrolled off elsewhere.
        const { selection, clickRow } = useLibraryStore.getState();
        const wasSelected = isSelected(selection, track.id);
        if (!wasSelected) {
          clickRow(rowIndex, track.id, {});
        }
        const dragged = wasSelected ? [...selection.ids] : [track.id];
        setTrackIds(event.dataTransfer, dragged);
        event.dataTransfer.effectAllowed = "copyMove";
        // Torn down on the next frame: the badge has to be in the document
        // long enough to be rasterized, and gone before it can be seen sitting
        // off-screen.
        const cleanUp = setDragImage(event, dragged.length);
        requestAnimationFrame(cleanUp);
      }}
      onDragOver={(event) => {
        if (!onReorder || !hasTrackIds(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropIndex(dropIndexFor(rowIndex, offsetWithin(event), ROW_HEIGHT));
      }}
      onDrop={(event) => {
        if (!onReorder) {
          return;
        }
        event.preventDefault();
        const target = dropIndexFor(rowIndex, offsetWithin(event), ROW_HEIGHT);
        setDropIndex(null);
        const ids = readTrackIds(event.dataTransfer);
        if (ids.length > 0) {
          onReorder(ids, target);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          select(event);
          onActivate?.(rowIndex);
        } else if (event.key === "Delete" && (onRemove || onRemoveFromLibrary)) {
          event.preventDefault();
          const { selection } = useLibraryStore.getState();
          const ids = track && !isSelected(selection, track.id) ? [track.id] : [...selection.ids];
          if (ids.length > 0) {
            // The playlist reading wins where both are on offer: it is the
            // less destructive one, and the one the view is about. Outside a
            // static playlist there is no membership to take a row out of, so
            // what is left is the library itself.
            (onRemove ?? onRemoveFromLibrary)?.(ids);
          }
        }
        // Space is deliberately not handled: it is the global play/pause
        // shortcut and has to reach the window.
      }}
    >
      <RowStatusCell track={track} playing={playing} />
      {columns.map((column) => (
        <td
          key={column.id}
          // Named so the header can find a column's cells to measure when a
          // divider is double-clicked to fit it.
          data-column={column.id}
          className={`song-cell${column.align === "right" ? " right" : ""}`}
          style={{ width: column.width }}
        >
          {/* A row whose page has not arrived renders a shimmer bar rather
              than blocking the scroll on a fetch. */}
          {track ? column.render(track) : <span className="skeleton" />}
        </td>
      ))}
    </tr>
  );
}
