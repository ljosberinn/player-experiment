import type React from "react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ContextMenu, type MenuItem, type MenuPosition } from "../../components/ui/ContextMenu";
import type { SortDirection, SortField } from "../../ipc";
import { columnDropIndex, draggedWidth, isDrag } from "./columnDrag";
import { ALL_COLUMNS, type ColumnDef, MIN_COLUMN_WIDTH } from "./columns";
import { useLibraryStore } from "./store";

/** A press that may become a reorder, once it has travelled far enough. */
interface HeaderDrag {
  id: SortField;
  index: number;
  startX: number;
  moved: boolean;
  dropIndex: number;
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
  const [menu, setMenu] = useState<MenuPosition | null>(null);

  /**
   * Suppresses the click that follows a drag.
   *
   * `pointerup` fires before `click`, so without this every reorder would also
   * sort by whichever column was dropped on.
   */
  const swallowClick = useRef(false);

  const headerBounds = () =>
    Array.from(rowRef.current?.querySelectorAll("th") ?? []).map((th) => {
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
    <>
      <tr
        ref={rowRef}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        {columns.map((column) => {
          const width = resize?.id === column.id ? resize.width : column.width;
          return (
            <th
              key={column.id}
              scope="col"
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
              <span
                className="column-resizer"
                data-testid={`resize-${column.id}`}
                onPointerDown={(event) => onResizePointerDown(event, column)}
                onPointerMove={onResizePointerMove}
                onPointerUp={onResizePointerUp}
              />
            </th>
          );
        })}
      </tr>

      {/* Portalled because this component renders inside <thead>, and a menu
          is a <div> - which is not valid there and which the browser would
          hoist out of the table anyway, taking its positioning with it. */}
      {menu === null
        ? null
        : createPortal(
            <ContextMenu
              items={menuItems}
              position={menu}
              onClose={() => setMenu(null)}
              label="Columns"
            />,
            document.body,
          )}
    </>
  );
}
