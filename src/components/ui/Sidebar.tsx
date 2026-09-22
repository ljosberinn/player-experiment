import { type ReactNode, useEffect, useRef } from "react";
import { sidebarRows, stepRow, tabStopRow } from "./sidebarKeys";

/**
 * The source list.
 *
 * Chrome only since phase 35. It used to take the fixed sources as data and
 * render them itself, which was one item - "Music" - and a shape built for more.
 * Everything in the sidebar now has behaviour of its own: the library views
 * switch the content pane, the playlists rename, delete and take drops. All of
 * them render through `children` and own that behaviour themselves.
 *
 * What it does own is the keyboard across all of them, because that is the one
 * thing no single child can see: which row Tab lands on, and where the arrows
 * go from there.
 */
export function Sidebar({ children }: { children?: ReactNode }) {
  const nav = useRef<HTMLElement>(null);

  /**
   * One tab stop for the whole sidebar rather than one per row.
   *
   * Tab used to walk every library view and every playlist before it reached
   * anything after the sidebar; now it lands on the open one and the arrows
   * walk the rest. Written onto the DOM rather than passed down as props: the
   * children draw their own rows and none of them can see the others, and
   * React sets no `tabIndex` on those buttons, so nothing here is undone by a
   * render.
   *
   * The observer is what keeps up with rows arriving - playlists load, sections
   * fold, the review queue appears when a pass has queued something. `tabindex`
   * is not in the filter, so writing it cannot feed the observer its own work.
   */
  useEffect(() => {
    const element = nav.current;
    if (element === null) {
      return;
    }
    const apply = () => {
      const rows = sidebarRows(element);
      const stop = tabStopRow(rows);
      rows.forEach((row, index) => {
        row.tabIndex = index === stop ? 0 : -1;
      });
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(element, {
      subtree: true,
      childList: true,
      attributeFilter: ["aria-current"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      className="sidebar"
      aria-label="Library"
      ref={nav}
      // Focus only: Enter and Space are what open a view, and a sidebar that
      // navigated on every arrow would re-query the library per keypress.
      onKeyDown={(event) => {
        const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
        if (step === 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
          return;
        }
        const element = nav.current;
        if (element === null) {
          return;
        }
        const rows = sidebarRows(element);
        const from = rows.indexOf(document.activeElement as HTMLElement);
        // Not on a row: the rename field is in here too, and the arrows move
        // its caret.
        if (from === -1) {
          return;
        }
        // Claimed even where it moves nothing, so an arrow held at the end of
        // the list does not fall through to the track list's window handler
        // and start moving a selection nobody can see.
        event.preventDefault();
        rows[stepRow(from, step, rows.length)]?.focus();
      }}
    >
      {children}
    </nav>
  );
}
