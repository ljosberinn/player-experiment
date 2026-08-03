import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
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
const TILE_WIDTH = 148;
const TILE_HEIGHT = 196;
const LIST_ROW_HEIGHT = 34;
const OVERSCAN = 6;

/**
 * Albums as a grid of covers, artists and genres as lists.
 *
 * Virtualized by row rather than by item: a grid's unit of scrolling is the
 * row, and the number of columns depends on the width, so the two are computed
 * together from the measured container.
 */
export function BrowseView({ kind }: { kind: BrowseKind }) {
  const groups = useLibraryStore((state) => state.groups);
  const loading = useLibraryStore((state) => state.groupsLoading);
  const openGroup = useLibraryStore((state) => state.openGroup);
  const search = useLibraryStore((state) => state.search);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isGrid = kind === "albums";
  // One column for the lists; for the grid, however many tiles fit. Falls back
  // to a single column before the first measurement, which is corrected on the
  // same frame rather than being visible.
  const width = scrollRef.current?.clientWidth ?? 0;
  const columns = isGrid ? Math.max(1, Math.floor(width / TILE_WIDTH)) : 1;
  const rowCount = Math.ceil(groups.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (isGrid ? TILE_HEIGHT : LIST_ROW_HEIGHT),
    overscan: OVERSCAN,
  });

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
    <div className="song-body browse-body" ref={scrollRef} data-testid="browse-scroll">
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
              className="browse-row"
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
