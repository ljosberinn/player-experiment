/**
 * The keyboard's shape for the source list.
 *
 * Split from `Sidebar` so the rules are testable without a render: what counts
 * as a row, which row Tab lands on, and where an arrow goes from here.
 *
 * Read off the DOM rather than threaded through as props, because the rows are
 * drawn by four components that know nothing of each other - the library
 * views, the two playlist sections, the review queue - and one roving index
 * shared between them would be four copies of one rule. `LibraryNav` chose
 * buttons over a tablist for this: "the arrows have to walk the whole
 * sidebar", and a tablist would have owned them one section at a time.
 */

/** What the arrows walk: a row you can go to, not a control on a heading. */
const ROW = ".sidebar-item";

export function sidebarRows(nav: ParentNode): HTMLElement[] {
  return [...nav.querySelectorAll<HTMLElement>(ROW)];
}

/**
 * Which row is the sidebar's single tab stop.
 *
 * Where the user already is - `aria-current` marks it, and exactly one row
 * carries it, because the open view and the open playlist are one answer to
 * one question. The first row is a fallback nothing should reach; a sidebar
 * with no tab stop is one the keyboard cannot enter, which is the wrong way to
 * find out that the invariant broke.
 */
export function tabStopRow(rows: readonly HTMLElement[]): number {
  const current = rows.findIndex((row) => row.getAttribute("aria-current") === "page");
  return current === -1 ? 0 : current;
}

/**
 * Where an arrow moves from `from`.
 *
 * Clamped, like the track list's: the ends of the sidebar are ends, and a wrap
 * from the last playlist back to Songs would be a jump across three sections
 * that nothing on screen suggests.
 */
export function stepRow(from: number, delta: -1 | 1, count: number): number {
  return Math.min(count - 1, Math.max(0, from + delta));
}
