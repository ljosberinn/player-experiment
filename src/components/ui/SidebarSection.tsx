import type { ReactNode } from "react";

/**
 * A sidebar section whose heading folds it away.
 *
 * Hand-rolled rather than Base UI's `Collapsible`, which is the exception to
 * how the rest of this app is built and worth saying why. `Collapsible.Panel`
 * keeps its contents mounted and hides them, and the contents here include the
 * drop target that creates a playlist - a hidden drop target is a thing a drag
 * can still find and a keyboard cannot, which is the wrong half of the trade.
 * Unmounting is also the honest reading of "collapsed": the section is not on
 * screen, so it is not in the tree.
 *
 * What Base UI would have given for free is the wiring, and that is three
 * attributes: the trigger says what it controls and whether it is open, and
 * the panel carries the id.
 */
export function SidebarSection({
  id,
  title,
  collapsed = false,
  onToggle,
  actions,
  children,
}: {
  /** Used for the heading and panel ids, so they have to be unique. */
  id: string;
  title: string;
  collapsed?: boolean;
  /** Absent for a section that does not fold, like LIBRARY. */
  onToggle?: () => void;
  /** The + buttons, which sit at the end of the heading row. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  const panelId = `${id}-panel`;

  return (
    <div className="sidebar-section">
      <div className="sidebar-title-row">
        <h2 className="sidebar-title" id={headingId}>
          {onToggle === undefined ? (
            title
          ) : (
            <button
              type="button"
              className="sidebar-fold"
              aria-expanded={!collapsed}
              aria-controls={panelId}
              onClick={onToggle}
            >
              {/* A disclosure triangle, drawn in CSS and rotated by the
                  collapsed state. Inside the button rather than beside it, so
                  the whole heading is the target rather than a 13px glyph. */}
              <span className="sidebar-chevron" aria-hidden="true" />
              {title}
            </button>
          )}
        </h2>
        {actions}
      </div>

      {collapsed ? null : <div id={panelId}>{children}</div>}
    </div>
  );
}
