import { openUrl } from "@tauri-apps/plugin-opener";
import { type RefObject, useEffect, useMemo, useState } from "react";
import { revealTrack } from "../../ipc";
import { useEditorStore } from "../editor/store";
import { useLoveEntry } from "../love/loveEntry";
import { isTypingTarget } from "../player/shortcuts";
import { usePlaylistsStore } from "../playlists/store";
import { useTagsourceStore } from "../tagsource/store";
import { measureColumns } from "./columnFit";
import { displayedColumns, resolveColumns } from "./columns";
import { rowMenuItems } from "./rowMenu";
import type { RowActions } from "./SongRow";
import { useLibraryStore } from "./store";

/** How far in from a row's left edge a keyboard-opened menu is anchored. */
const MENU_INSET = 9;

/** The row-level callbacks a view's owner supplies. */
export type SongTableHandlers = {
  onActivate?: ((rowIndex: number) => void) | undefined;
  onReorder?: ((trackIds: number[], targetIndex: number) => void) | undefined;
  onRemove?: ((trackIds: number[]) => void) | undefined;
  onRemoveFromLibrary?: ((trackIds: number[]) => void) | undefined;
  onExport?: ((trackIds: number[]) => void) | undefined;
};

/**
 * Everything a table of songs needs that is not its layout.
 *
 * Two views draw the same rows: the flat table, and a drill-in drawn as
 * release groups. What differs is how rows are placed - one virtualizes over
 * rows, the other over groups - and nothing else. The selection, the row menu
 * and the column fit are the same behaviour in both, and a second copy of them
 * is the copy that would drift.
 *
 * So this owns the shared half and the caller owns placement, handing back the
 * one thing placement decides: `scrollToRow`, because reaching a row means
 * reaching its group in one view and the row itself in the other.
 */
export function useSongTableWiring({
  scrollRef,
  scrollToRow,
  handlers,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Brings a row into view, however the caller places rows. */
  scrollToRow: (rowIndex: number) => void;
  handlers: SongTableHandlers;
}) {
  const { onActivate, onReorder, onRemove, onRemoveFromLibrary, onExport } = handlers;

  const total = useLibraryStore((s) => s.total);
  // Resolved here rather than in `App`, whose only use for the config was to
  // hand the result down: subscribing where the columns are rendered keeps a
  // width change - a drag, a fit - out of the shell's render entirely.
  const storedConfig = useLibraryStore((s) => s.columns);
  const browse = useLibraryStore((s) => s.browse);
  const columnConfig = useMemo(
    () => displayedColumns(storedConfig, browse),
    [storedConfig, browse],
  );
  const fittedWidths = useLibraryStore((s) => s.fittedWidths);
  const columns = useMemo(
    () => resolveColumns(columnConfig, fittedWidths),
    [columnConfig, fittedWidths],
  );
  const sortBy = useLibraryStore((s) => s.sortBy);
  const direction = useLibraryStore((s) => s.direction);
  const selection = useLibraryStore((s) => s.selection);
  const rowAt = useLibraryStore((s) => s.rowAt);
  // For the Love entry, which is handed a selection by id rather than by row.
  const trackById = useLibraryStore((s) => s.trackById);
  const ensureRange = useLibraryStore((s) => s.ensureRange);
  const toggleSort = useLibraryStore((s) => s.toggleSort);
  // Subscribing to `pages` is what re-renders rows when a page lands; `rowAt`
  // reads from the store and would otherwise look unchanged to React.
  const pages = useLibraryStore((s) => s.pages);
  const fitPending = useLibraryStore((s) => s.fitPending);
  const fitColumns = useLibraryStore((s) => s.fitColumns);
  // A new query drops every cached page, so the visible range has to be
  // fetched again - but the range itself has not moved, and neither has the
  // row count when only the sort changed. Without this the caller's effect
  // never re-runs and the table sits on placeholder rows forever.
  const queryToken = useLibraryStore((s) => s.queryToken);

  const playlistId = useLibraryStore((s) => s.playlistId);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const addTracks = usePlaylistsStore((s) => s.addTracks);
  const openEditor = useEditorStore((s) => s.open);
  const openLookup = useTagsourceStore((s) => s.open);

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

  // Built here rather than inside the items expression below: it subscribes,
  // and a hook cannot live in a branch that only runs while a menu is open.
  const loving = useLoveEntry(menu?.trackIds ?? [], trackById);

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
   * Fits the columns to a view that has just been opened.
   *
   * Once the first page has landed, not when the navigation happened: rows
   * that have not arrived render a skeleton bar, and measuring those measures
   * the shimmer. A view that lands no rows leaves the request outstanding -
   * there is nothing to measure, and nothing to be wrong about either.
   */
  useEffect(() => {
    // The scroll container rather than the table inside it: a drill-in draws
    // the header in one table and each group's rows in another, and measuring
    // the first table alone would fit every column to its heading.
    const measured = scrollRef.current;
    if (!fitPending || pages.size === 0 || measured === null) {
      return;
    }
    fitColumns(measureColumns(measured, columnConfig.ids));
  }, [fitPending, pages, fitColumns, columnConfig.ids, scrollRef]);

  /**
   * The keyboard's routes into the rows: the row menu, and the arrows that
   * move the selection.
   *
   * On the window rather than on a row, because nothing has a row focused when
   * either is wanted - Ctrl+A and a click in the sidebar both leave focus off
   * the table, and the selection they leave behind is exactly what these act
   * on. State is read through `getState` for the same reason
   * `useSelectionShortcuts` does: the listener is bound once and must not see
   * a selection from the render it was created in.
   *
   * Here rather than in `SongTable` so the drill-in has them too: it draws the
   * same rows against the same selection, and a keyboard that worked in one
   * view and not the other would be the difference nobody could explain.
   */
  useEffect(() => {
    /**
     * Brings `rowIndex` into view and hands its `<tr>` to `then`.
     *
     * The row may not be mounted: the selection can sit outside the window
     * after a scroll, and the scroll above only renders it on the next frame.
     */
    const withRow = (rowIndex: number, then: (row: HTMLTableRowElement) => void) => {
      scrollToRow(rowIndex);
      requestAnimationFrame(() => {
        const row = scrollRef.current?.querySelector<HTMLTableRowElement>(
          `tr[aria-rowindex="${rowIndex + 1}"]`,
        );
        if (row) {
          then(row);
        }
      });
    };

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
    const openMenuAt = (rowIndex: number) =>
      withRow(rowIndex, (row) => {
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

    const onKeyDown = (event: KeyboardEvent) => {
      // A row handles its own keys first, and a text field keeps all of them -
      // which covers the scrubber and the volume rail too, both of them an
      // `<input type="range">` that moves on the arrows it is given.
      if (event.defaultPrevented || isTypingTarget(event.target)) {
        return;
      }

      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (step !== 0) {
        // Bare keys only. Alt+Arrow nudges a playlist's order and Shift+Arrow
        // is left for whoever asks for a range extension; neither is this.
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
          return;
        }
        const target = useLibraryStore.getState().moveAnchor(step);
        if (target === null) {
          return;
        }
        event.preventDefault();
        withRow(target, (row) => row.focus());
        return;
      }

      // Windows opens a context menu with the Menu key or Shift+F10, and the
      // second exists because not every keyboard has the first.
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
        return;
      }
      const { selection: current } = useLibraryStore.getState();
      if (current.ids.size === 0 || current.anchorIndex === null) {
        return;
      }
      event.preventDefault();
      openMenuAt(current.anchorIndex);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scrollRef, scrollToRow]);

  /** The row menu's entries for whatever it was opened on, or none. */
  const menuItems =
    menu === null
      ? []
      : rowMenuItems({
          count: menu.trackIds.length,
          playlists,
          openPlaylist: playlists.find((one) => one.id === playlistId) ?? null,
          // The row under the pointer, whatever else is selected: it is the one
          // the lookup entries name, and the menu disables them unless it is
          // the only row.
          track: rowAt(menu.rowIndex),
          onPlay: () => onActivate?.(menu.rowIndex),
          onEdit: () => void openEditor(menu.trackIds),
          onLookup: () => void openLookup(menu.trackIds),
          onAddTo: (id) => void addTracks(id, menu.trackIds),
          onRemove: () => onRemove?.(menu.trackIds),
          // Passed through as undefined where the caller gave none, so the
          // entry is absent rather than present and inert - which is also how
          // the Edit menu keeps from carrying it.
          onRemoveFromLibrary: onRemoveFromLibrary
            ? () => onRemoveFromLibrary(menu.trackIds)
            : undefined,
          loving,
          onExport: () => onExport?.(menu.trackIds),
          // One id: the menu disables this entry unless exactly one row is
          // selected, so there is no question of which file to show.
          onReveal: () => void revealTrack(menu.trackIds[0] as number),
          // Nothing to report on failure: the browser either opened or it did
          // not, and the user can see which.
          onOpenUrl: (url) => void openUrl(url).catch(() => {}),
        });

  return {
    total,
    columns,
    sortBy,
    direction,
    selection,
    rowAt,
    // Not `pages` itself: subscribing to it above is what re-renders the view
    // when a page lands, and no caller has anything to do with the map.
    queryToken,
    ensureRange,
    toggleSort,
    actions,
    dropIndex,
    setDropIndex,
    setMenu,
    menuItems,
  };
}
