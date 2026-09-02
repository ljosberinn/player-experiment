import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type BrowseGroup, type BrowseKind, coverUrl } from "../../ipc";
import { formatDuration } from "../../lib/format";
import { groupId, groupMeta, groupSubtitle, groupTitle } from "./browse";
import { useLibraryStore } from "./store";

/**
 * Tile and row metrics.
 *
 * Both are fixed rather than measured: the virtualizer needs a size before it
 * has rendered anything, and a grid whose rows resize as covers load would
 * reflow under the scroll position.
 */
const TILE_WIDTH = 168;
const TILE_GAP = 10;
const TILE_HEIGHT = 235;
const LIST_ROW_HEIGHT = 41;
const OVERSCAN = 6;

/**
 * Albums as a grid of covers, artists and genres as lists.
 *
 * Virtualized by row rather than by item: a grid's unit of scrolling is the
 * row, and the number of columns depends on the width, so the two are computed
 * together from the measured container.
 *
 * One instance per tab, keyed on it in `App`. Albums and Artists are two
 * places rather than two renderings of one: unkeyed they shared a scroll
 * container, so opening Artists landed wherever the album grid had been left,
 * and the reflow correction below then rewrote that offset in the grid's row
 * height. Each tab keeps its own place instead, through the store, since the
 * instance holding it is gone by the time it is wanted again.
 */
export function BrowseView({ kind }: { kind: BrowseKind }) {
  // See the same directive in `SongTable`: a `useVirtualizer` in the body is
  // one React Compiler will not memoize around.
  "use no memo";

  const groups = useLibraryStore((state) => state.groups);
  const loading = useLibraryStore((state) => state.groupsLoading);
  const openGroup = useLibraryStore((state) => state.openGroup);
  const search = useLibraryStore((state) => state.search);
  // The one piece of the remembered position that is subscribed to: the
  // offsets themselves are read through `getState`, so scrolling costs no
  // render, while this changes only when a search or a playlist has thrown
  // every offset away.
  const listToken = useLibraryStore((state) => state.browseListToken);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isGrid = kind === "albums";
  const rowHeight = isGrid ? TILE_HEIGHT : LIST_ROW_HEIGHT;
  // Measured into state rather than read off the ref during render: a ref read
  // is whatever the last commit left there, so the column count was fixed at
  // the first measurement and the grid never reflowed with the window.
  const [width, setWidth] = useState(0);

  // Attached through a ref callback rather than a mount effect: until the first
  // groups arrive the view renders the empty state, so the scroll container is
  // not in the DOM on mount and an effect keyed to mount would measure nothing
  // and never run again.
  const attachScroll = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    return () => {
      scrollRef.current = null;
    };
  }, []);

  // The section is measured rather than the scroll container around it: a row
  // is as wide as the section, while the container's `clientWidth` also counts
  // `.browse-body`'s 30px of padding on each side. Counting columns against
  // those extra 60px overflowed the grid at every width where the surplus was
  // less than one tile - about a quarter of them, the maximised window among
  // them.
  const attachRow = useCallback((element: HTMLElement | null) => {
    if (element === null) {
      return;
    }
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // One column for the lists; for the grid, however many tiles fit. `n` tiles
  // need `n` widths and the `n - 1` gaps between them, which is the gap added
  // to both sides of the division. Falls back to a single column before the
  // first measurement, which is corrected on the same frame rather than being
  // visible.
  const columns = isGrid
    ? Math.max(1, Math.floor((width + TILE_GAP) / (TILE_WIDTH + TILE_GAP)))
    : 1;
  const rowCount = Math.ceil(groups.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
  });

  /** The group at the top, kept up to date without a render. */
  const topGroupRef = useRef(0);

  // A resize changes how many groups a row holds without changing how tall a
  // row is, so the scroll offset survives it while the data under it does not:
  // the same pixel is now a different album. Re-anchor on the group that was at
  // the top, and drop the size cache, whose entries are keyed by a row index
  // that no longer means the same thing.
  //
  // `null` until the first measurement, and skipped there: `columns` falls
  // back to 1 until `attachRow` reports a width, so the first commit at four
  // columns looks exactly like a reflow. Harmless against a scrollTop of 0,
  // but it would divide a restored offset by four.
  const columnsRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (width === 0 || element === null) {
      return;
    }
    const previous = columnsRef.current;
    columnsRef.current = columns;
    if (previous === null || previous === columns) {
      return;
    }
    const topGroup = Math.floor(element.scrollTop / rowHeight) * previous;
    element.scrollTop = Math.floor(topGroup / columns) * rowHeight;
    virtualizer.measure();
  }, [columns, width, rowHeight, virtualizer]);

  // Restored once the groups are in, not on mount: the empty state has no
  // container to scroll, and an offset means nothing to the virtualizer before
  // it has a count. After the effect above, so the first measurement is on
  // record and cannot mistake this for a reflow.
  //
  // Keyed to the list token rather than latched, so a search that changes what
  // the tabs list puts the open one back at the top as well: it has read the
  // offsets already, and clearing them alone would leave it where it was, on a
  // row of a list that is gone.
  const restoredTokenRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (
      restoredTokenRef.current === listToken ||
      element === null ||
      width === 0 ||
      rowCount === 0
    ) {
      return;
    }
    restoredTokenRef.current = listToken;
    const topGroup = useLibraryStore.getState().browseOffsets[kind];
    // Recorded as well as applied: leaving again without scrolling must not
    // write back a zero over the place being restored.
    topGroupRef.current = topGroup;
    element.scrollTop = Math.floor(topGroup / columns) * rowHeight;
  }, [kind, width, rowCount, columns, rowHeight, listToken]);

  // On unmount, because that is the moment the place is worth keeping and the
  // only one at which a single write covers a whole visit. Through `getState`,
  // so a scroll never wakes a subscriber.
  //
  // Only once this instance has restored, because until then it knows nothing:
  // `topGroupRef` still reads 0, and writing that back is writing over the
  // offset it is waiting for the groups to arrive so it can use. StrictMode
  // makes exactly that happen in development - it mounts, tears down and
  // remounts, and the teardown lands while the groups are still in flight.
  useEffect(() => {
    return () => {
      if (restoredTokenRef.current === null) {
        return;
      }
      useLibraryStore.getState().rememberBrowseOffset(kind, topGroupRef.current);
    };
  }, [kind]);

  if (!loading && groups.length === 0) {
    return (
      <div className="song-body">
        <p className="empty-state">
          {search.trim() === "" ? "No songs yet" : `No results for “${search}”`}
        </p>
      </div>
    );
  }

  return (
    <div
      className="song-body browse-body"
      ref={attachScroll}
      data-testid="browse-scroll"
      onScroll={(event) => {
        topGroupRef.current = Math.floor(event.currentTarget.scrollTop / rowHeight) * columns;
      }}
    >
      {/* A labelled section rather than role="list": the virtualizer needs a
          row wrapper between the container and each item, which breaks the
          list/listitem relationship a screen reader relies on, and claiming it
          anyway would describe a structure that is not there. A section with a
          label is a region, which is true and needs no role attribute. */}
      <section
        ref={attachRow}
        className={isGrid ? "browse-grid" : "browse-list"}
        style={{ height: virtualizer.getTotalSize() }}
        aria-label={kind}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const start = row.index * columns;
          const inRow = groups.slice(start, start + columns);
          return (
            <div
              key={row.key}
              // Parity of the data index, not `:nth-child`: the rows are
              // virtualized and absolutely positioned, so the DOM holds the
              // window rather than the list. Lists only - the grid is tiles.
              className={!isGrid && row.index % 2 === 1 ? "browse-row odd" : "browse-row"}
              style={{ height: row.size, transform: `translateY(${row.start}px)` }}
            >
              {inRow.map((group) => (
                <BrowseItem
                  key={groupId(group)}
                  group={group}
                  kind={kind}
                  grid={isGrid}
                  onOpen={() => void openGroup(group)}
                />
              ))}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function BrowseItem({
  group,
  kind,
  grid,
  onOpen,
}: {
  group: BrowseGroup;
  kind: BrowseKind;
  grid: boolean;
  onOpen: () => void;
}) {
  const title = groupTitle(group, kind);
  const subtitle = groupSubtitle(group, kind);

  return (
    // A button, not a div with a click handler: this is the primary way into a
    // group, so it has to be reachable and activatable from the keyboard.
    <button type="button" className={grid ? "browse-tile" : "browse-item"} onClick={onOpen}>
      {grid ? (
        <span className="browse-cover">
          {group.coverHash === null ? (
            // Not an <img> with a placeholder src: a broken image is a request
            // that fails and an icon the browser picks. An empty box is
            // deliberate and costs nothing.
            <span className="browse-cover-empty" aria-hidden="true" />
          ) : (
            <img src={coverUrl(group.coverHash)} alt="" loading="lazy" />
          )}
        </span>
      ) : null}
      <span className="browse-title">{title}</span>
      {subtitle === null ? null : <span className="browse-subtitle">{subtitle}</span>}
      <span className="browse-meta">
        {groupMeta(group)}
        {group.durationMs > 0 ? ` · ${formatDuration(group.durationMs)}` : ""}
      </span>
    </button>
  );
}
