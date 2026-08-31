import type React from "react";
import { useRef, useState } from "react";
import { ContextMenu, type MenuItem } from "../../components/ui/ContextMenu";
import type { SortDirection, SortField } from "../../ipc";
import { columnDropIndex, draggedWidth, fittedWidth, isDrag } from "./columnDrag";
import { ALL_COLUMNS, type ColumnDef, MIN_COLUMN_WIDTH } from "./columns";
import { STATUS_COLUMN_WIDTH } from "./rowStatus";
import { useLibraryStore } from "./store";

/** A press that may become a reorder, once it has travelled far enough. */
interface HeaderDrag {
  id: SortField;
  index: number;
  startX: number;
  moved: boolean;
  dropIndex: number;
}

/**
 * How wide the contents of one cell are laid out, ignoring any clipping.
 *
 * A `Range` over the contents rather than the element's own box: the box is
 * the column width, and `scrollWidth` on a clipped element omits the padding
 * on the overflowing side.
 */
function contentWidth(cell: Element): number {
  const range = document.createRange();
  range.selectNodeContents(cell);
  return range.getBoundingClientRect().width;
}

/** A divider drag, with the width it started from. */
interface ResizeDrag {
  id: SortField;
  startX: number;
  startWidth: number;
  width: number;
}

/**
 * The table's header row: sorting, reordering, resizing and the column menu.
 *
 * Split out of `SongTable` because these four things share one pointer press
 * and would otherwise be interleaved through the row rendering.
 */
export function ColumnHeader({
  columns,
  sortBy,
  direction,
  onSort,
}: {
  columns: ColumnDef[];
  sortBy: SortField;
  direction: SortDirection;
  onSort: (id: SortField) => void;
}) {
  const visible = useLibraryStore((state) => state.columns.ids);
  const toggleColumn = useLibraryStore((state) => state.toggleColumn);
  const moveColumn = useLibraryStore((state) => state.moveColumn);
  const resizeColumn = useLibraryStore((state) => state.resizeColumn);
  const resetColumns = useLibraryStore((state) => state.resetColumns);

  const rowRef = useRef<HTMLTableRowElement>(null);
  const [drag, setDrag] = useState<HeaderDrag | null>(null);
  const [resize, setResize] = useState<ResizeDrag | null>(null);

  /**
   * Suppresses the click that follows a drag.
   *
   * `pointerup` fires before `click`, so without this every reorder would also
   * sort by whichever column was dropped on.
   */
  const swallowClick = useRef(false);

  // `[data-column]` rather than every `th`: the status column is a fixed first
  // header with no id, and counting it would offset every drop index by one.
  const headerBounds = () =>
    Array.from(rowRef.current?.querySelectorAll("th[data-column]") ?? []).map((th) => {
      const rect = th.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });

  const onHeaderPointerDown = (event: React.PointerEvent<HTMLElement>, id: SortField) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const index = columns.findIndex((column) => column.id === id);
    setDrag({ id, index, startX: event.clientX, moved: false, dropIndex: index });
  };

  const onHeaderPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (drag === null) {
      return;
    }
    const moved = drag.moved || isDrag(drag.startX, event.clientX);
    if (!moved) {
      return;
    }
    setDrag({
      ...drag,
      moved: true,
      dropIndex: columnDropIndex(headerBounds(), drag.index, event.clientX),
    });
  };

  const onHeaderPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (drag === null) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved) {
      swallowClick.current = true;
      void moveColumn(drag.id, drag.dropIndex);
    }
    setDrag(null);
  };

  const onResizePointerDown = (event: React.PointerEvent<HTMLElement>, column: ColumnDef) => {
    if (event.button !== 0) {
      return;
    }
    // Without this the press also starts a reorder, and the header travels
    // with the divider.
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResize({
      id: column.id,
      startX: event.clientX,
      startWidth: column.width,
      width: column.width,
    });
  };

  const onResizePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (resize === null) {
      return;
    }
    event.stopPropagation();
    // Held locally and committed on release: a store write per pixel would
    // persist a hundred layouts across one drag.
    setResize({
      ...resize,
      width: draggedWidth(resize.startWidth, resize.startX, event.clientX, MIN_COLUMN_WIDTH),
    });
  };

  const onResizePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (resize === null) {
      return;
    }
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    swallowClick.current = true;
    void resizeColumn(resize.id, resize.width);
    setResize(null);
  };

  /**
   * Double-click on a divider: widen or narrow the column to fit what is in it.
   *
   * Measured with a `Range` over each cell's contents rather than read off
   * `scrollWidth`: the cells clip with `text-overflow: ellipsis`, and a
   * clipped element's scroll width leaves out the padding on the far side.
   */
  const onResizeDoubleClick = (event: React.MouseEvent<HTMLElement>, id: SortField) => {
    event.stopPropagation();
    const row = rowRef.current;
    const table = row?.closest("table");
    if (row === null || table == null) {
      return;
    }

    const header = row.querySelector(`th[data-column="${id}"] .song-header-cell`);
    const cells = table.querySelectorAll(`td.song-cell[data-column="${id}"]`);
    const contents = [...(header === null ? [] : [header]), ...cells].map(contentWidth);

    // The drag in progress, if any, is abandoned rather than committed - a
    // double-click is two presses, and the first left a `resize` behind.
    setResize(null);
    void resizeColumn(id, fittedWidth(contents, MIN_COLUMN_WIDTH));
  };

  const menuItems: MenuItem[] = [
    ...ALL_COLUMNS.map((column) => ({
      // A check rather than a checkbox: the menu is a list of columns, and the
      // marker says which are on. Hiding the last one is refused by the store,
      // so it is disabled here rather than failing silently when picked.
      label: `${visible.includes(column.id) ? "✓ " : "    "}${column.label}`,
      disabled: visible.length === 1 && visible[0] === column.id,
      onSelect: () => void toggleColumn(column.id),
    })),
    { kind: "separator" as const },
    { label: "Reset Columns", onSelect: () => void resetColumns() },
  ];

  return (
    // The header row is the trigger. It replaces the `onContextMenu` phase 20
    // added, and with it the portal that used to be needed: a menu is a div,
    // which is not valid inside a <thead> and which the browser hoisted out of
    // the table anyway, taking its positioning with it. Base UI portals to the
    // body itself.
    <ContextMenu label="Columns" items={menuItems} render={<tr ref={rowRef} />}>
      {/* The status column: first, fixed, and not in `columns` at all - it
            cannot be sorted by, hidden, reordered or resized, so it has no
            business in the configurable set. It carries no visible label, so
            it needs a stated one or screen readers announce an empty column
            header for every row. */}
      <th scope="col" className="status" style={{ width: STATUS_COLUMN_WIDTH }}>
        <span className="visually-hidden">Status</span>
      </th>

      {columns.map((column) => {
        const width = resize?.id === column.id ? resize.width : column.width;
        return (
          <th
            key={column.id}
            scope="col"
            data-column={column.id}
            style={{ width }}
            data-dragging={drag?.moved && drag.id === column.id ? "true" : undefined}
            aria-sort={
              sortBy === column.id ? (direction === "asc" ? "ascending" : "descending") : "none"
            }
          >
            <button
              type="button"
              className="song-header-cell"
              onPointerDown={(event) => onHeaderPointerDown(event, column.id)}
              onPointerMove={onHeaderPointerMove}
              onPointerUp={onHeaderPointerUp}
              onClick={() => {
                if (swallowClick.current) {
                  swallowClick.current = false;
                  return;
                }
                onSort(column.id);
              }}
            >
              {column.label}
              {sortBy === column.id ? (
                <span className="sort-arrow" aria-hidden="true">
                  {direction === "asc" ? "▲" : "▼"}
                </span>
              ) : null}
            </button>

            {/* Not a button: it is a drag handle with nothing to activate,
                  and announcing one per column would bury the headers. Column
                  width is reachable from the keyboard only in the sense that
                  it does not need to be - nothing is unreachable without it. */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: a drag handle for a width, not a control - a keyboard route to it would announce a divider per column to bury the headers, and nothing is unreachable without one. */}
            <span
              className="column-resizer"
              data-testid={`resize-${column.id}`}
              onPointerDown={(event) => onResizePointerDown(event, column)}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
              onDoubleClick={(event) => onResizeDoubleClick(event, column.id)}
            />
          </th>
        );
      })}
    </ContextMenu>
  );
}
