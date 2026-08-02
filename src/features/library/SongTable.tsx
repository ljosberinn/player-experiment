import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import type { SortField } from "../../ipc";
import type { ColumnDef } from "./columns";
import { isSelected } from "./selection";
import { useLibraryStore } from "./store";

const ROW_HEIGHT = 22;
/** Rows rendered beyond the viewport, so a fast flick shows content not gaps. */
const OVERSCAN = 12;

export function SongTable({ columns }: { columns: ColumnDef[] }) {
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

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const items = virtualizer.getVirtualItems();
  const firstIndex = items[0]?.index ?? 0;
  const lastIndex = items[items.length - 1]?.index ?? 0;

  useEffect(() => {
    if (total > 0) {
      void ensureRange(firstIndex, lastIndex);
    }
  }, [ensureRange, firstIndex, lastIndex, total]);

  return (
    <div className="song-table">
      <div className="song-header" role="row">
        {columns.map((column) => (
          <button
            key={column.id}
            type="button"
            role="columnheader"
            className="song-header-cell"
            style={{ width: column.width }}
            aria-sort={
              sortBy === column.id ? (direction === "asc" ? "ascending" : "descending") : "none"
            }
            onClick={() => void toggleSort(column.id as SortField)}
          >
            {column.label}
            {sortBy === column.id ? (
              <span className="sort-arrow" aria-hidden="true">
                {direction === "asc" ? "▲" : "▼"}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="song-body" ref={scrollRef} data-testid="song-scroll">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {items.map((item) => {
            const track = rowAt(item.index);
            return (
              <div
                key={item.key}
                role="row"
                aria-rowindex={item.index + 1}
                className={[
                  "song-row",
                  item.index % 2 === 1 ? "odd" : "",
                  track && isSelected(selection, track.id) ? "selected" : "",
                  track ? "" : "placeholder",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: ROW_HEIGHT,
                  transform: `translateY(${item.start}px)`,
                }}
                onClick={(event) => {
                  if (track) {
                    clickRow(item.index, track.id, {
                      shift: event.shiftKey,
                      meta: event.ctrlKey || event.metaKey,
                    });
                  }
                }}
                onKeyDown={(event) => {
                  if (track && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    clickRow(item.index, track.id, {
                      shift: event.shiftKey,
                      meta: event.ctrlKey || event.metaKey,
                    });
                  }
                }}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: rows are selectable grid cells
                tabIndex={0}
              >
                {columns.map((column) => (
                  <div
                    key={column.id}
                    role="gridcell"
                    className={`song-cell${column.align === "right" ? " right" : ""}`}
                    style={{ width: column.width }}
                  >
                    {/* A row whose page has not arrived renders a shimmer bar
                        rather than blocking the scroll on a fetch. */}
                    {track ? column.render(track) : <span className="skeleton" />}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
