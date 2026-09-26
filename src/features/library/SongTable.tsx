import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef } from "react";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { isTypingTarget } from "../player/shortcuts";
import { nudgeTarget } from "../playlists/reorder";
import {
  dropIndexAt,
  edgeScrollSpeed,
  isTrackDragging,
  onTrackDragEnd,
} from "../playlists/trackDrag";
import { ColumnHeader } from "./ColumnHeader";
import { rowIndicesOf } from "./pageCache";
import { type DropEdge, ROW_HEIGHT, SongRow } from "./SongRow";
import { isSelected } from "./selection";
import { useLibraryStore } from "./store";
import { type SongTableHandlers, useSongTableWiring } from "./useSongTableWiring";

/** Rows rendered beyond the viewport, so a fast flick shows content not gaps. */
const OVERSCAN = 12;
/**
 * How far in from the top and bottom of the list a drag starts scrolling it.
 *
 * One row: deep enough to be reachable without leaving the list, shallow
 * enough that dropping onto the first or last visible row is still possible.
 */
const EDGE_SCROLL_BAND_PX = ROW_HEIGHT;

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
}: SongTableHandlers & {
  nowPlayingId?: number | null;
}) {
  // React Compiler declines to memoize any component holding a
  // `useVirtualizer`: TanStack Virtual returns functions that change identity
  // without the instance doing so, and memoizing around them shows stale rows.
  // Saying so here is what keeps `panicThreshold: "all_errors"` meaningful -
  // see vite.config.ts.
  "use no memo";

  const scrollRef = useRef<HTMLDivElement>(null);

  const total = useLibraryStore((s) => s.total);
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // Stable across renders so the hook's keyboard listener is bound once.
  const scrollToRow = useCallback(
    (rowIndex: number) => virtualizer.scrollToIndex(rowIndex),
    [virtualizer],
  );

  const {
    columns,
    sortBy,
    direction,
    selection,
    rowAt,
    queryToken,
    ensureRange,
    toggleSort,
    actions,
    dropIndex,
    setDropIndex,
    setMenu,
    menuItems,
  } = useSongTableWiring({
    scrollRef,
    scrollToRow,
    handlers: { onActivate, onReorder, onRemove, onRemoveFromLibrary, onExport },
  });

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
  }, [setDropIndex]);

  const items = virtualizer.getVirtualItems();
  const firstIndex = items[0]?.index ?? 0;
  const lastIndex = items[items.length - 1]?.index ?? 0;

  /**
   * The one row Tab reaches, which the arrows then move from.
   *
   * The anchor, unless it has been scrolled out of the window - a selection
   * outlives the pages behind it, so the anchor can sit thousands of rows
   * away, and a tab stop on a row nothing renders is a table the keyboard
   * cannot enter at all. The first rendered row is where the user is looking.
   */
  const anchor = selection.anchorIndex;
  const tabStop =
    anchor !== null && anchor >= firstIndex && anchor <= lastIndex ? anchor : firstIndex;

  // biome-ignore lint/correctness/useExhaustiveDependencies: queryToken is a cache key, not a value this effect reads - it changes exactly when the cached pages are dropped, which is when the visible range must be fetched again even though the range itself has not moved.
  useEffect(() => {
    if (total > 0) {
      void ensureRange(firstIndex, lastIndex);
    }
  }, [ensureRange, firstIndex, lastIndex, total, queryToken]);

  /**
   * Nudges a selection up or down inside a playlist.
   *
   * Alt rather than a bare arrow: bare arrows seek and move the selection, and
   * every handler that takes one drops anything with a modifier - so an Alt
   * chord cannot collide with them by construction. The premise held when the
   * pair was seek and volume and it holds now that it is seek and the
   * selection. Only this view has it: a drill-in is ordered by release, which
   * is not an order to rearrange.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) {
        return;
      }
      if (!onReorder || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
        return;
      }
      const { selection: current, pages: cached, total: rowCount } = useLibraryStore.getState();
      const indices = rowIndicesOf(cached, current.ids);
      if (indices === null) {
        return;
      }
      const target = nudgeTarget(indices, event.key === "ArrowUp" ? "up" : "down", rowCount);
      if (target === null) {
        return;
      }
      event.preventDefault();
      onReorder([...current.ids], target);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onReorder]);

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
            onSort={toggleSort}
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
          items={menuItems}
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
                focused={item.index === tabStop}
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
