import type { SortField } from "../../ipc";
import { fittedWidth } from "./columnDrag";
import { type FittedWidths, MIN_COLUMN_WIDTH } from "./columns";

/**
 * Measuring a column against the table it is rendered in.
 *
 * Shared by the two things that fit a column: double-clicking its divider, and
 * a navigation landing rows. Its own module because both callers are far apart
 * - one is an event handler on the header, the other an effect on the table -
 * and this was trapped inside the first of them.
 */

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

/**
 * The width that fits column `id`'s header and every one of its cells that is
 * currently in `table`.
 *
 * Visible rows only - see `fittedWidth`, which owns that compromise.
 */
export function measuredWidth(table: Element, id: SortField): number {
  const header = table.querySelector(`th[data-column="${id}"] .song-header-cell`);
  const cells = table.querySelectorAll(`td.song-cell[data-column="${id}"]`);
  const contents = [...(header === null ? [] : [header]), ...cells].map(contentWidth);
  return fittedWidth(contents, MIN_COLUMN_WIDTH);
}

/**
 * A width for each of `ids` that has anything in `table` to measure.
 *
 * A column with nothing rendered is left out rather than given the minimum: a
 * width invented from a measurement of nothing would be applied the moment the
 * column was switched on.
 */
export function measureColumns(table: Element, ids: readonly SortField[]): FittedWidths {
  const widths: FittedWidths = {};
  for (const id of ids) {
    if (table.querySelector(`[data-column="${id}"]`) !== null) {
      widths[id] = measuredWidth(table, id);
    }
  }
  return widths;
}
