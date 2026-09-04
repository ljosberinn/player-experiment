import { useVirtualizer } from "@tanstack/react-virtual";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { revealTrack } from "../../ipc";
import { useEditorStore } from "../editor/store";
import { isTypingTarget } from "../player/shortcuts";
import { nudgeTarget } from "../playlists/reorder";
import { usePlaylistsStore } from "../playlists/store";
import {
  dropIndexAt,
  edgeScrollSpeed,
  isTrackDragging,
  onTrackDragEnd,
} from "../playlists/trackDrag";
import { useTagsourceStore } from "../tagsource/store";
import { ColumnHeader } from "./ColumnHeader";
import { measureColumns } from "./columnFit";
import { resolveColumns } from "./columns";
import { rowIndicesOf } from "./pageCache";
import { rowMenuItems } from "./rowMenu";
import { type DropEdge, ROW_HEIGHT, type RowActions, SongRow } from "./SongRow";
import { isSelected } from "./selection";
import { useLibraryStore } from "./store";

/** Rows rendered beyond the viewport, so a fast flick shows content not gaps. */
const OVERSCAN = 12;
/**
 * How far in from the top and bottom of the list a drag starts scrolling it.
 *
 * One row: deep enough to be reachable without leaving the list, shallow
 * enough that dropping onto the first or last visible row is still possible.
 */
const EDGE_SCROLL_BAND_PX = ROW_HEIGHT;
/** How far in from a row's left edge a keyboard-opened menu is anchored. */
const MENU_INSET = 8;

/**
 * Real table markup rather than divs with ARIA roles: `role="grid"` gives
 * screen readers row/column semantics for free, and `aria-rowcount` tells them
 * the true size of a library only a window of which is ever in the DOM.
 * Virtualization comes from CSS - thead/tbody are laid out as blocks so rows
 * can be absolutely positioned.
 */
export function SongTable({
  onActivate,
  onReorder,
  onRemove,
  onRemoveFromLibrary,
  onExport,
  nowPlayingId = null,
}: {
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
   * Take those rows out of the library itself.
   *
   * Its own prop rather than a second meaning for `onRemove`, which keeps
   * saying "out of this playlist": inside a static playlist both are on offer
   * at once, and Delete has to pick the less destructive one.
   */
  onRemoveFromLibrary?: ((trackIds: number[]) => void) | undefined;
  /**
   * Export the rows named. Lives with the caller because it opens a save
   * dialog, which is the shell's business rather than the table's.
   */
  onExport?: ((trackIds: number[]) => void) | undefined;
  nowPlayingId?: number | null;
}) {
  // React Compiler declines to memoize any component holding a
  // `useVirtualizer`: TanStack Virtual returns functions that change identity
  // without the instance doing so, and memoizing around them shows stale rows.
  // Saying so here is what keeps `panicThreshold: "all_errors"` meaningful -
  // see vite.config.ts.
  "use no memo";

  const total = useLibraryStore((s) => s.total);
  // Resolved here rather than in `App`, whose only use for the config was to
  // hand the result down: subscribing where the columns are rendered keeps a
  // width change - a drag, a fit - out of the shell's render entirely.
  const columnConfig = useLibraryStore((s) => s.columns);
  const fittedWidths = useLibraryStore((s) => s.fittedWidths);
  // Hand-written, because this component is not compiled: a fresh array here
  // would be a changed prop on all forty-odd rows for every render of the
  // body, which is exactly what the split below is for.
  const columns = useMemo(
    () => resolveColumns(columnConfig, fittedWidths),
    [columnConfig, fittedWidths],
  );
  const sortBy = useLibraryStore((s) => s.sortBy);
  const direction = useLibraryStore((s) => s.direction);
  const selection = useLibraryStore((s) => s.selection);
  const rowAt = useLibraryStore((s) => s.rowAt);
  const ensureRange = useLibraryStore((s) => s.ensureRange);
  const toggleSort = useLibraryStore((s) => s.toggleSort);
  // Subscribing to `pages` is what re-renders rows when a page lands; `rowAt`
  // reads from the store and would otherwise look unchanged to React.
  const pages = useLibraryStore((s) => s.pages);
  const fitPending = useLibraryStore((s) => s.fitPending);
  const fitColumns = useLibraryStore((s) => s.fitColumns);
  // A new query drops every cached page, so the visible range has to be
  // fetched again - but the range itself has not moved, and neither has the
  // row count when only the sort changed. Without this the effect below never
  // re-runs and the table sits on placeholder rows forever.
  const queryToken = useLibraryStore((s) => s.queryToken);

  const playlistId = useLibraryStore((s) => s.playlistId);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const addTracks = usePlaylistsStore((s) => s.addTracks);
  const openEditor = useEditorStore((s) => s.open);
  const openLookup = useTagsourceStore((s) => s.open);

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

  // Rebuilt only when one of the callers' handlers changes, so a scroll, a
  // click or a dragover leaves every row's props `Object.is`-equal and React
  // bails out on the cells beneath them.
  const actions: RowActions = useMemo(
    () => ({
      onActivate,
      onReorder,
      onRemove,
      onRemoveFromLibrary,
      onContextMenu: setMenu,
      setDropIndex,
    }),
    [onActivate, onReorder, onRemove, onRemoveFromLibrary],
  );

  /**
   * Where the pointer is while a drag is over the list, and the frame loop
   * scrolling towards it.
   *
   * Refs rather than state: the loop runs every frame and writing either of
   * these into a render would cost the table one per frame on top of the drop
   * index it actually has to publish.
   */
  const dragY = useRef<number | null>(null);
  const scrollFrame = useRef<number | null>(null);

  const stopEdgeScroll = () => {
    if (scrollFrame.current !== null) {
      cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
    }
  };

  /**
   * Scrolls the list while a drag is held near its top or bottom edge.
   *
   * `scrollTop +=` rather than `scrollBy`, which jsdom does not implement.
   * Off the frame delta rather than a fixed step per frame, so the speed is
   * the same on a 60Hz panel and a 144Hz one.
   *
   * The drop index is recomputed here too: a stationary pointer over a
   * scrolling virtualized list fires no `pointermove`, yet the rows under it
   * are changing.
   */
  const runEdgeScroll = (previous: number) => {
    scrollFrame.current = requestAnimationFrame((now) => {
      const element = scrollRef.current;
      const y = dragY.current;
      if (element === null || y === null || !isTrackDragging()) {
        stopEdgeScroll();
        return;
      }
      const rect = element.getBoundingClientRect();
      const speed = edgeScrollSpeed(y, rect.top, rect.bottom, EDGE_SCROLL_BAND_PX);
      if (speed === 0) {
        stopEdgeScroll();
        return;
      }
      element.scrollTop += (speed * (now - previous)) / 1000;
      const body = element.querySelector("tbody");
      if (body !== null) {
        setDropIndex(
          dropIndexAt(
            y - body.getBoundingClientRect().top,
            ROW_HEIGHT,
            useLibraryStore.getState().total,
          ),
        );
      }
      runEdgeScroll(now);
    });
  };

  // A drag can end anywhere - a drop on the sidebar, Escape, the pointer
  // leaving the window - and none of those reach this component as an event of
  // its own, so the indicator and the loop would both outlive it. The same
  // teardown serves unmount, where a running loop would hold a dead element.
  useEffect(() => {
    const cancel = () => {
      if (scrollFrame.current !== null) {
        cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = null;
      }
    };
    const unsubscribe = onTrackDragEnd(() => {
      cancel();
      setDropIndex(null);
    });
    return () => {
      unsubscribe();
      cancel();
    };
  }, []);

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
   * Fits the columns to a view that has just been opened.
   *
   * Once the first page has landed, not when the navigation happened: rows
   * that have not arrived render a skeleton bar, and measuring those measures
   * the shimmer. A view that lands no rows leaves the request outstanding -
   * there is nothing to measure, and nothing to be wrong about either.
   */
  useEffect(() => {
    const table = scrollRef.current?.querySelector("table");
    if (!fitPending || pages.size === 0 || table == null) {
      return;
    }
    fitColumns(measureColumns(table, columnConfig.ids));
  }, [fitPending, pages, fitColumns, columnConfig.ids]);

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

    const onKeyDown = (event: KeyboardEvent) => {
      // A row handles its own keys first, and a text field keeps all of them.
      if (event.defaultPrevented || isTypingTarget(event.target)) {
        return;
      }

      // Windows opens a context menu with the Menu key or Shift+F10, and the
      // second exists because not every keyboard has the first.
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        const { selection } = useLibraryStore.getState();
        if (selection.ids.size === 0 || selection.anchorIndex === null) {
          return;
        }
        event.preventDefault();
        openMenuAt(selection.anchorIndex);
        return;
      }

      // Alt rather than a bare arrow: bare arrows are the player's seek and
      // volume keys, and `shortcutFor` drops anything with a modifier - so an
      // Alt chord cannot collide with them by construction.
      if (!onReorder || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
        return;
      }
      const { selection, pages, total: rowCount } = useLibraryStore.getState();
      const indices = rowIndicesOf(pages, selection.ids);
      if (indices === null) {
        return;
      }
      const target = nudgeTarget(indices, event.key === "ArrowUp" ? "up" : "down", rowCount);
      if (target === null) {
        return;
      }
      event.preventDefault();
      onReorder([...selection.ids], target);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onReorder, virtualizer]);

  return (
    <div
      className="song-body"
      ref={scrollRef}
      data-testid="song-scroll"
      // On the scroll container rather than on the rows: the bands sit at its
      // edges, which is where the header is at the top and empty space at the
      // bottom, and neither of those is a row.
      onPointerMove={(event) => {
        if (!onReorder || !isTrackDragging()) {
          return;
        }
        dragY.current = event.clientY;
        if (scrollFrame.current === null) {
          runEdgeScroll(performance.now());
        }
      }}
      onPointerLeave={() => {
        dragY.current = null;
      }}
    >
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
              onPointerLeave={() => setDropIndex(null)}
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
                  onEdit: () => void openEditor(menu.trackIds),
                  onLookup: () => void openLookup(menu.trackIds),
                  onAddTo: (id) => void addTracks(id, menu.trackIds),
                  onRemove: () => onRemove?.(menu.trackIds),
                  // Passed through as undefined where the caller gave none, so
                  // the entry is absent rather than present and inert - which
                  // is also how the Edit menu keeps from carrying it.
                  onRemoveFromLibrary: onRemoveFromLibrary
                    ? () => onRemoveFromLibrary(menu.trackIds)
                    : undefined,
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
          {items.map((item) => {
            const track = rowAt(item.index);
            // Derived here rather than passed raw: `dropIndex` as a prop would
            // change on every row for one dragover.
            const drop: DropEdge =
              dropIndex === item.index
                ? "before"
                : dropIndex === total && item.index === total - 1
                  ? "after"
                  : null;

            return (
              <SongRow
                key={item.key}
                track={track}
                rowIndex={item.index}
                top={item.start}
                selected={track !== null && isSelected(selection, track.id)}
                playing={track !== null && track.id === nowPlayingId}
                drop={drop}
                columns={columns}
                actions={actions}
              />
            );
          })}
        </ContextMenu>
      </table>
    </div>
  );
}
