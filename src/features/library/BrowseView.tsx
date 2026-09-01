import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
const TILE_WIDTH = 178;
const TILE_HEIGHT = 235;
const LIST_ROW_HEIGHT = 41;
const OVERSCAN = 6;

/**
 * Albums as a grid of covers, artists and genres as lists.
 *
 * Virtualized by row rather than by item: a grid's unit of scrolling is the
 * row, and the number of columns depends on the width, so the two are computed
 * together from the measured container.
 */
export function BrowseView({ kind }: { kind: BrowseKind }) {
  // See the same directive in `SongTable`: a `useVirtualizer` in the body is
  // one React Compiler will not memoize around.
  "use no memo";

  const groups = useLibraryStore((state) => state.groups);
  const loading = useLibraryStore((state) => state.groupsLoading);
  const openGroup = useLibraryStore((state) => state.openGroup);
  const search = useLibraryStore((state) => state.search);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isGrid = kind === "albums";
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
    if (element === null) {
      return;
    }
    // `clientWidth`, not the entry's `contentRect`: the tiles lay out inside
    // the padding box, and the box the observer reports excludes the padding.
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => {
      observer.disconnect();
      scrollRef.current = null;
    };
  }, []);

  // One column for the lists; for the grid, however many tiles fit. Falls back
  // to a single column before the first measurement, which is corrected on the
  // same frame rather than being visible.
  const columns = isGrid ? Math.max(1, Math.floor(width / TILE_WIDTH)) : 1;
  const rowCount = Math.ceil(groups.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (isGrid ? TILE_HEIGHT : LIST_ROW_HEIGHT),
    overscan: OVERSCAN,
  });

  // A resize changes how many groups a row holds without changing how tall a
  // row is, so the scroll offset survives it while the data under it does not:
  // the same pixel is now a different album. Re-anchor on the group that was at
  // the top, and drop the size cache, whose entries are keyed by a row index
  // that no longer means the same thing.
  const columnsRef = useRef(columns);
  useLayoutEffect(() => {
    const previous = columnsRef.current;
    columnsRef.current = columns;
    const element = scrollRef.current;
    if (previous === columns || element === null) {
      return;
    }
    const topGroup = Math.floor(element.scrollTop / TILE_HEIGHT) * previous;
    element.scrollTop = Math.floor(topGroup / columns) * TILE_HEIGHT;
    virtualizer.measure();
  }, [columns, virtualizer]);

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
    <div className="song-body browse-body" ref={attachScroll} data-testid="browse-scroll">
      {/* A labelled section rather than role="list": the virtualizer needs a
          row wrapper between the container and each item, which breaks the
          list/listitem relationship a screen reader relies on, and claiming it
          anyway would describe a structure that is not there. A section with a
          label is a region, which is true and needs no role attribute. */}
      <section
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
