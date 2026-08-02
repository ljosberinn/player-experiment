import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import type { SortField } from "../../ipc";
import type { ColumnDef } from "./columns";
import { isSelected } from "./selection";
import { useLibraryStore } from "./store";

const ROW_HEIGHT = 22;
/** Rows rendered beyond the viewport, so a fast flick shows content not gaps. */
const OVERSCAN = 12;

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
  nowPlayingId = null,
}: {
  columns: ColumnDef[];
  /** Double-click or Enter on a row: play the library from that row. */
  onActivate?: (rowIndex: number) => void;
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
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                style={{ width: column.width }}
                aria-sort={
                  sortBy === column.id ? (direction === "asc" ? "ascending" : "descending") : "none"
                }
              >
                <button
                  type="button"
                  className="song-header-cell"
                  onClick={() => void toggleSort(column.id as SortField)}
                >
                  {column.label}
                  {sortBy === column.id ? (
                    <span className="sort-arrow" aria-hidden="true">
                      {direction === "asc" ? "▲" : "▼"}
                    </span>
                  ) : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>

        <tbody style={{ height: virtualizer.getTotalSize() }}>
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
                className={[
                  "song-row",
                  item.index % 2 === 1 ? "odd" : "",
                  track && isSelected(selection, track.id) ? "selected" : "",
                  track && track.id === nowPlayingId ? "playing" : "",
                  track ? "" : "placeholder",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                onClick={select}
                onDoubleClick={() => onActivate?.(item.index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    select(event);
                    onActivate?.(item.index);
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
    </div>
  );
}
