import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { openUrl } from "@tauri-apps/plugin-opener";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { revealTrack, type Track } from "../../ipc";
import { useEditorStore } from "../editor/store";
import { isTypingTarget } from "../player/shortcuts";
import {
  dropIndexFor,
  hasTrackIds,
  readTrackIds,
  setDragImage,
  setTrackIds,
} from "../playlists/drag";
import { nudgeTarget } from "../playlists/reorder";
import { usePlaylistsStore } from "../playlists/store";
import { ColumnHeader } from "./ColumnHeader";
import type { ColumnDef } from "./columns";
import { rowIndicesOf } from "./pageCache";
import { RowStatusCell } from "./RowStatusCell";
import { rowMenuItems } from "./rowMenu";
import { type ClickModifiers, isSelected, type Selection } from "./selection";
import { useLibraryStore } from "./store";

const ROW_HEIGHT = 26;
/** Rows rendered beyond the viewport, so a fast flick shows content not gaps. */
const OVERSCAN = 12;
/** How far in from a row's left edge a keyboard-opened menu is anchored. */
const MENU_INSET = 8;

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
 * Where an Alt+arrow nudge would move the selection, or null when the chord is
 * not a nudge or there is nowhere for it to go.
 *
 * Alt rather than a bare arrow: bare arrows are the player's seek and volume
 * keys, and `shortcutFor` drops anything with a modifier - so an Alt chord
 * cannot collide with them by construction.
 */
function nudgeFor(event: KeyboardEvent): { ids: number[]; target: number } | null {
  if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
    return null;
  }
  const { selection, pages, total } = useLibraryStore.getState();
  const indices = rowIndicesOf(pages, selection.ids);
  if (indices === null) {
    return null;
  }
  const target = nudgeTarget(indices, event.key === "ArrowUp" ? "up" : "down", total);
  return target === null ? null : { ids: [...selection.ids], target };
}

/**
 * The window-level half of the table's keyboard, acting on the selection
 * rather than on whatever has focus.
 *
 * State is read through `getState` for the same reason `useSelectionShortcuts`
 * does: the listener is bound once and must not see a selection from the
 * render it was created in.
 */
function tableKey(
  event: KeyboardEvent,
  openMenuAt: (rowIndex: number) => void,
  onReorder: ((trackIds: number[], targetIndex: number) => void) | undefined,
): void {
  // A row handles its own keys first, and a text field keeps all of them.
  if (event.defaultPrevented || isTypingTarget(event.target)) {
    return;
  }

  // Windows opens a context menu with the Menu key or Shift+F10, and the
  // second exists because not every keyboard has the first.
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    const { selection } = useLibraryStore.getState();
    if (selection.ids.size > 0 && selection.anchorIndex !== null) {
      event.preventDefault();
      openMenuAt(selection.anchorIndex);
    }
    return;
  }

  const nudge = onReorder === undefined ? null : nudgeFor(event);
  if (nudge === null) {
    return;
  }
  event.preventDefault();
  onReorder?.(nudge.ids, nudge.target);
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
  /**
   * What the open row menu acts on.
   *
   * No longer where it is: Base UI's trigger derives the position from the
   * event it owns. What stays is the part that was never about positioning -
   * which rows the menu applies to, decided on the right-click before the menu
   * opens.
   */
  const [menu, setMenu] = useState<{ trackIds: number[]; rowIndex: number } | null>(null);

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

  /**
   * The keyboard routes into the two things a pointer had to itself: the row
   * menu, and reordering a playlist.
   *
   * On the window rather than on a row, because neither has a row focused when
   * it is wanted - Ctrl+A and a click in the sidebar both leave focus off the
   * table, and the selection they leave behind is exactly what these act on.
   * State is read through `getState` for the same reason `useSelectionShortcuts`
   * does: the listener is bound once and must not see a selection from the
   * render it was created in.
   */
  useEffect(() => {
    /**
     * Opens the row menu on `rowIndex` by handing the trigger the event it
     * owns.
     *
     * A synthesized `contextmenu` rather than a second way in: `ContextMenu`
     * derives its position from that event, and the row's own handler decides
     * which rows the menu acts on. Both of those would have to be duplicated
     * by any route that opened the menu directly, and the duplicate is what
     * would drift.
     */
    const openMenuAt = (rowIndex: number) => {
      virtualizer.scrollToIndex(rowIndex);
      // The row may not be mounted: the selection can sit outside the window
      // after a scroll, and the scroll above only renders it on the next frame.
      requestAnimationFrame(() => {
        const row = scrollRef.current?.querySelector<HTMLTableRowElement>(
          `tr[aria-rowindex="${rowIndex + 1}"]`,
        );
        if (!row) {
          return;
        }
        // Focused first, so closing the menu returns the keyboard to the row
        // it was opened on rather than to the body.
        row.focus();
        const rect = row.getBoundingClientRect();
        row.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + MENU_INSET,
            clientY: rect.top + rect.height / 2,
          }),
        );
      });
    };

    const onKeyDown = (event: KeyboardEvent) => tableKey(event, openMenuAt, onReorder);

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onReorder, virtualizer]);

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

        {/* The whole row area is the trigger, so the menu opens where the
            pointer is without anybody carrying coordinates around. Which rows
            it acts on is still decided per row, below, before it opens. */}
        <ContextMenu
          label="Song actions"
          render={
            <tbody
              style={{ height: virtualizer.getTotalSize() }}
              onDragLeave={() => setDropIndex(null)}
            />
          }
          onOpenChange={(open) => {
            if (!open) {
              setMenu(null);
            }
          }}
          items={
            menu === null
              ? []
              : rowMenuItems({
                  count: menu.trackIds.length,
                  playlists,
                  openPlaylist: playlists.find((one) => one.id === playlistId) ?? null,
                  // The row under the pointer, whatever else is selected: it
                  // is the one the lookup entries name, and the menu disables
                  // them unless it is the only row.
                  track: rowAt(menu.rowIndex),
                  onPlay: () => onActivate?.(menu.rowIndex),
                  onGetInfo: () => void openEditor(menu.trackIds),
                  onAddTo: (id) => void addTracks(id, menu.trackIds),
                  onRemove: () => onRemove?.(menu.trackIds),
                  onExport: () => onExport?.(menu.trackIds),
                  // One id: the menu disables this entry unless exactly one row
                  // is selected, so there is no question of which file to show.
                  onReveal: () => void revealTrack(menu.trackIds[0] as number),
                  // Nothing to report on failure: the browser either opened or
                  // it did not, and the user can see which.
                  onOpenUrl: (url) => void openUrl(url).catch(() => {}),
                })
          }
        >
          {items.map((item) => (
            <SongRow
              key={item.key}
              item={item}
              track={rowAt(item.index)}
              columns={columns}
              selection={selection}
              nowPlayingId={nowPlayingId}
              dropIndex={dropIndex}
              total={total}
              onActivate={onActivate}
              onRemove={onRemove}
              onReorder={onReorder}
              onClickRow={clickRow}
              onMenu={setMenu}
              onDropIndex={setDropIndex}
            />
          ))}
        </ContextMenu>
      </table>
    </div>
  );
}

/** What a row's state adds to `song-row`, as one class attribute. */
function rowClasses({
  index,
  track,
  selection,
  nowPlayingId,
  dropIndex,
  total,
}: {
  index: number;
  track: Track | null;
  selection: Selection;
  nowPlayingId: number | null;
  dropIndex: number | null;
  total: number;
}): string {
  return [
    "song-row",
    index % 2 === 1 ? "odd" : "",
    track && isSelected(selection, track.id) ? "selected" : "",
    track && track.id === nowPlayingId ? "playing" : "",
    track ? "" : "placeholder",
    dropIndex === index ? "drop-before" : "",
    dropIndex === total && index === total - 1 ? "drop-after" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * One row, and everything a pointer or the keyboard can do to it.
 *
 * `track` is null for a row whose page has not arrived: the row still occupies
 * its place and still scrolls, it just has nothing to say yet, so every
 * handler here has to cope with having no track.
 */
function SongRow({
  item,
  track,
  columns,
  selection,
  nowPlayingId,
  dropIndex,
  total,
  onActivate,
  onRemove,
  onReorder,
  onClickRow,
  onMenu,
  onDropIndex,
}: {
  item: VirtualItem;
  track: Track | null;
  columns: ColumnDef[];
  selection: Selection;
  nowPlayingId: number | null;
  dropIndex: number | null;
  total: number;
  onActivate?: ((rowIndex: number) => void) | undefined;
  onRemove?: ((trackIds: number[]) => void) | undefined;
  onReorder?: ((trackIds: number[], targetIndex: number) => void) | undefined;
  onClickRow: (rowIndex: number, id: number, modifiers: ClickModifiers) => void;
  onMenu: (menu: { trackIds: number[]; rowIndex: number } | null) => void;
  onDropIndex: (index: number | null) => void;
}) {
  const select = (event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    if (track) {
      onClickRow(item.index, track.id, {
        shift: event.shiftKey,
        meta: event.ctrlKey || event.metaKey,
      });
    }
  };

  return (
    <tr
      aria-rowindex={item.index + 1}
      aria-selected={track ? isSelected(selection, track.id) : undefined}
      tabIndex={0}
      draggable={track !== null}
      className={rowClasses({
        index: item.index,
        track,
        selection,
        nowPlayingId,
        dropIndex,
        total,
      })}
      style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
      onClick={select}
      onDoubleClick={() => onActivate?.(item.index)}
      onContextMenu={() => {
        // No preventDefault and no stopPropagation: the trigger on <tbody>
        // needs this event to reach it, and suppressing the webview's own menu
        // is its job now.
        if (!track) {
          onMenu(null);
          return;
        }
        // Right-clicking outside the selection acts on the row under the
        // pointer, the way every file manager does - otherwise the menu would
        // silently apply to rows scrolled off screen.
        const inSelection = isSelected(selection, track.id);
        if (!inSelection) {
          onClickRow(item.index, track.id, {});
        }
        onMenu({
          trackIds: inSelection ? [...selection.ids] : [track.id],
          rowIndex: item.index,
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
        const wasSelected = isSelected(selection, track.id);
        if (!wasSelected) {
          onClickRow(item.index, track.id, {});
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
        onDropIndex(dropIndexFor(item.index, offsetWithin(event), ROW_HEIGHT));
      }}
      onDrop={(event) => {
        if (!onReorder) {
          return;
        }
        event.preventDefault();
        const target = dropIndexFor(item.index, offsetWithin(event), ROW_HEIGHT);
        onDropIndex(null);
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
          const ids = track && !isSelected(selection, track.id) ? [track.id] : [...selection.ids];
          if (ids.length > 0) {
            onRemove(ids);
          }
        }
        // Space is deliberately not handled: it is the global play/pause
        // shortcut and has to reach the window.
      }}
    >
      <RowStatusCell track={track} nowPlayingId={nowPlayingId} />
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
