import { useVirtualizer } from "@tanstack/react-virtual";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { ContextMenu, type MenuPosition } from "../../components/ui/ContextMenu";
import { revealTrack } from "../../ipc";
import { useEditorStore } from "../editor/store";
import {
  dropIndexFor,
  hasTrackIds,
  readTrackIds,
  setDragImage,
  setTrackIds,
} from "../playlists/drag";
import { usePlaylistsStore } from "../playlists/store";
import { ColumnHeader } from "./ColumnHeader";
import type { ColumnDef } from "./columns";
import { rowMenuItems } from "./rowMenu";
import { isSelected } from "./selection";
import { useLibraryStore } from "./store";

const ROW_HEIGHT = 22;
/** Rows rendered beyond the viewport, so a fast flick shows content not gaps. */
const OVERSCAN = 12;

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
 * Real table markup rather than divs with ARIA roles: `role="grid"` gives
 * screen readers row/column semantics for free, and `aria-rowcount` tells them
 * the true size of a library only a window of which is ever in the DOM.
 * Virtualization comes from CSS - thead/tbody are laid out as blocks so rows
 * can be absolutely positioned.
 */
export function SongTable({
  columns,
  onActivate,
  onReorder,
  onRemove,
  onExport,
  nowPlayingId = null,
}: {
  columns: ColumnDef[];
  /** Double-click or Enter on a row: play the library from that row. */
  onActivate?: (rowIndex: number) => void;
  /**
   * Accepts a drag of rows dropped back onto the table.
   *
   * Absent means the view has no order of its own to rearrange - the library
   * and any column-sorted view are derived orders, and dropping a row into one
   * would have nothing to persist.
   */
  onReorder?: ((trackIds: number[], targetIndex: number) => void) | undefined;
  /** Delete on a selection: take those rows out of the current playlist. */
  onRemove?: ((trackIds: number[]) => void) | undefined;
  /**
   * Export the rows named. Lives with the caller because it opens a save
   * dialog, which is the shell's business rather than the table's.
   */
  onExport?: ((trackIds: number[]) => void) | undefined;
  nowPlayingId?: number | null;
}) {
  const total = useLibraryStore((s) => s.total);
  const sortBy = useLibraryStore((s) => s.sortBy);
  const direction = useLibraryStore((s) => s.direction);
  const selection = useLibraryStore((s) => s.selection);
  const rowAt = useLibraryStore((s) => s.rowAt);
  const ensureRange = useLibraryStore((s) => s.ensureRange);
  const toggleSort = useLibraryStore((s) => s.toggleSort);
  const clickRow = useLibraryStore((s) => s.clickRow);
  // Subscribing to `pages` is what re-renders rows when a page lands; `rowAt`
  // reads from the store and would otherwise look unchanged to React.
  useLibraryStore((s) => s.pages);
  // A new query drops every cached page, so the visible range has to be
  // fetched again - but the range itself has not moved, and neither has the
  // row count when only the sort changed. Without this the effect below never
  // re-runs and the table sits on placeholder rows forever.
  const queryToken = useLibraryStore((s) => s.queryToken);

  const playlistId = useLibraryStore((s) => s.playlistId);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const addTracks = usePlaylistsStore((s) => s.addTracks);
  const openEditor = useEditorStore((s) => s.open);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** Where a reorder drop would land, as an index into the current order. */
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  /** The open row menu: where it is, and what it acts on. */
  const [menu, setMenu] = useState<{
    at: MenuPosition;
    trackIds: number[];
    rowIndex: number;
  } | null>(null);

  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const items = virtualizer.getVirtualItems();
  const firstIndex = items[0]?.index ?? 0;
  const lastIndex = items[items.length - 1]?.index ?? 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: queryToken is a cache key, not a value this effect reads - it changes exactly when the cached pages are dropped, which is when the visible range must be fetched again even though the range itself has not moved.
  useEffect(() => {
    if (total > 0) {
      void ensureRange(firstIndex, lastIndex);
    }
  }, [ensureRange, firstIndex, lastIndex, total, queryToken]);

  return (
    <div className="song-body" ref={scrollRef} data-testid="song-scroll">
      <table className="song-table" aria-rowcount={total}>
        <thead>
          <ColumnHeader
            columns={columns}
            sortBy={sortBy}
            direction={direction}
            onSort={(id) => void toggleSort(id)}
          />
        </thead>

        <tbody
          style={{ height: virtualizer.getTotalSize() }}
          onDragLeave={() => setDropIndex(null)}
        >
          {items.map((item) => {
            const track = rowAt(item.index);
            const select = (event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
              if (track) {
                clickRow(item.index, track.id, {
                  shift: event.shiftKey,
                  meta: event.ctrlKey || event.metaKey,
                });
              }
            };

            return (
              <tr
                key={item.key}
                aria-rowindex={item.index + 1}
                aria-selected={track ? isSelected(selection, track.id) : undefined}
                tabIndex={0}
                draggable={track !== null}
                className={[
                  "song-row",
                  item.index % 2 === 1 ? "odd" : "",
                  track && isSelected(selection, track.id) ? "selected" : "",
                  track && track.id === nowPlayingId ? "playing" : "",
                  track ? "" : "placeholder",
                  dropIndex === item.index ? "drop-before" : "",
                  dropIndex === total && item.index === total - 1 ? "drop-after" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                onClick={select}
                onDoubleClick={() => onActivate?.(item.index)}
                onContextMenu={(event) => {
                  if (!track) {
                    return;
                  }
                  event.preventDefault();
                  // Right-clicking outside the selection acts on the row under
                  // the pointer, the way every file manager does - otherwise
                  // the menu would silently apply to rows scrolled off screen.
                  const inSelection = isSelected(selection, track.id);
                  if (!inSelection) {
                    clickRow(item.index, track.id, {});
                  }
                  setMenu({
                    at: { x: event.clientX, y: event.clientY },
                    trackIds: inSelection ? [...selection.ids] : [track.id],
                    rowIndex: item.index,
                  });
                }}
                onDragStart={(event) => {
                  if (!track) {
                    event.preventDefault();
                    return;
                  }
                  // Dragging a row outside the selection makes that row the
                  // selection first, so what moves is what the pointer grabbed
                  // rather than something scrolled off elsewhere.
                  const wasSelected = isSelected(selection, track.id);
                  if (!wasSelected) {
                    clickRow(item.index, track.id, {});
                  }
                  const dragged = wasSelected ? [...selection.ids] : [track.id];
                  setTrackIds(event.dataTransfer, dragged);
                  event.dataTransfer.effectAllowed = "copyMove";
                  // Torn down on the next frame: the badge has to be in the
                  // document long enough to be rasterized, and gone before it
                  // can be seen sitting off-screen.
                  const cleanUp = setDragImage(event, dragged.length);
                  requestAnimationFrame(cleanUp);
                }}
                onDragOver={(event) => {
                  if (!onReorder || !hasTrackIds(event.dataTransfer)) {
                    return;
                  }
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropIndex(dropIndexFor(item.index, offsetWithin(event), ROW_HEIGHT));
                }}
                onDrop={(event) => {
                  if (!onReorder) {
                    return;
                  }
                  event.preventDefault();
                  const target = dropIndexFor(item.index, offsetWithin(event), ROW_HEIGHT);
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
                    onActivate?.(item.index);
                  } else if (event.key === "Delete" && onRemove) {
                    event.preventDefault();
                    const ids =
                      track && !isSelected(selection, track.id) ? [track.id] : [...selection.ids];
                    if (ids.length > 0) {
                      onRemove(ids);
                    }
                  }
                  // Space is deliberately not handled: it is the global
                  // play/pause shortcut and has to reach the window.
                }}
              >
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={`song-cell${column.align === "right" ? " right" : ""}`}
                    style={{ width: column.width }}
                  >
                    {/* A row whose page has not arrived renders a shimmer bar
                        rather than blocking the scroll on a fetch. */}
                    {track ? column.render(track) : <span className="skeleton" />}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      {menu ? (
        <ContextMenu
          position={menu.at}
          label="Song actions"
          onClose={() => setMenu(null)}
          items={rowMenuItems({
            count: menu.trackIds.length,
            playlists,
            openPlaylist: playlists.find((one) => one.id === playlistId) ?? null,
            onPlay: () => onActivate?.(menu.rowIndex),
            onGetInfo: () => void openEditor(menu.trackIds),
            onAddTo: (id) => void addTracks(id, menu.trackIds),
            onRemove: () => onRemove?.(menu.trackIds),
            onExport: () => onExport?.(menu.trackIds),
            // One id: the menu disables this entry unless exactly one row is
            // selected, so there is no question of which file to show.
            onReveal: () => void revealTrack(menu.trackIds[0] as number),
          })}
        />
      ) : null}
    </div>
  );
}
