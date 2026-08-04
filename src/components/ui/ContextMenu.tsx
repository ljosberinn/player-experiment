import { ContextMenu as Base } from "@base-ui/react/context-menu";
import type React from "react";

/**
 * One entry in a context menu.
 *
 * `submenu` and `onSelect` are alternatives: an item either does something or
 * opens a list of things that do.
 *
 * Unchanged by the move to Base UI, deliberately: this union is the vocabulary
 * every call site builds menus in, and `rowMenu.ts` knows nothing about how a
 * menu opens.
 */
export type MenuItem =
  | { kind: "separator" }
  | {
      kind?: "item";
      label: string;
      onSelect?: (() => void) | undefined;
      /** Shown greyed and skipped by the keyboard, rather than hidden. */
      disabled?: boolean | undefined;
      submenu?: MenuItem[] | undefined;
    };

/**
 * A context menu over the region it applies to.
 *
 * The hand-rolled version this replaced was a real menu, and the arguments for
 * building it still hold - they were arguments against an *OS* menu, which
 * cannot cheaply render a live list of playlists. They were never arguments
 * against a headless primitive. What did not hold was the cost: collision
 * nudging, outside-click capture, focus restoration and submenu alignment were
 * all debugged by hand here, and Floating UI does them.
 *
 * The region is the trigger rather than a captured pointer position. A spike on
 * 2026-08-03 built the position-based adapter first and found that Base UI
 * routes a menu's arrow keys through its trigger, so a menu rendered `open` at
 * a point has no keyboard support at all - six of thirteen tests failed against
 * an adapter that otherwise worked. `ContextMenu.Trigger` owns the
 * `contextmenu` event and derives the position itself, which is why call sites
 * hand over the element instead of the coordinates.
 */
export function ContextMenu({
  items,
  label = "Context menu",
  render,
  children,
  onContextMenu,
  onOpenChange,
}: {
  items: MenuItem[];
  label?: string;
  /**
   * What the trigger renders as - a `<tbody>`, a row, a header.
   *
   * The menu wraps the thing it describes rather than sitting beside it, so
   * there is never a question of which row was hit.
   */
  render: React.ReactElement<Record<string, unknown>>;
  children?: React.ReactNode;
  /**
   * Runs before the menu opens, on the same event.
   *
   * Which rows a menu acts on is still the call site's decision - right-clicking
   * outside the selection acts on the row under the pointer - and that has to be
   * settled before the items are built.
   */
  onContextMenu?: React.MouseEventHandler<HTMLElement>;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Base.Root onOpenChange={onOpenChange}>
      <Base.Trigger render={render} onContextMenu={onContextMenu}>
        {children}
      </Base.Trigger>
      {/* No items, no popup. The alternative is an empty box: right-clicking a
          row whose page has not arrived has nothing to offer, and the trigger
          region covers those rows too. */}
      {items.length === 0 ? null : (
        <Base.Portal>
          <Base.Positioner className="context-positioner">
            <Base.Popup className="context-menu" aria-label={label}>
              {items.map(renderMenuItem)}
            </Base.Popup>
          </Base.Positioner>
        </Base.Portal>
      )}
    </Base.Root>
  );
}

/**
 * One entry, rendered.
 *
 * Exported since phase 34 so the menu bar draws its items with this and not
 * with a copy. Every part below except `Root` and `Trigger` is literally the
 * same component in Base UI's context-menu and menu namespaces - the two
 * differ only in what opens them - so sharing this is not a trick, and it is
 * what stops the Edit menu and the right-click menu, which offer the same
 * actions, from slowly looking like two different menus.
 */
export function renderMenuItem(item: MenuItem, index: number) {
  if (item.kind === "separator") {
    // Keyed by index: a menu's items are a fixed list built at open time and
    // never reordered, and a separator has nothing else to key on.
    return <Base.Separator key={`sep-${index}`} className="context-separator" />;
  }

  if (item.submenu) {
    return (
      <Base.SubmenuRoot key={item.label}>
        <Base.SubmenuTrigger className="context-item has-submenu" disabled={item.disabled}>
          {item.label}
          <span className="context-arrow" aria-hidden="true">
            ▸
          </span>
        </Base.SubmenuTrigger>
        <Base.Portal>
          <Base.Positioner className="context-positioner">
            <Base.Popup className="context-menu" aria-label={item.label}>
              {item.submenu.length === 0 ? (
                // A submenu that renders nothing looks broken; this explains it.
                <div className="context-empty">No playlists yet</div>
              ) : (
                item.submenu.map(renderMenuItem)
              )}
            </Base.Popup>
          </Base.Positioner>
        </Base.Portal>
      </Base.SubmenuRoot>
    );
  }

  return (
    <Base.Item
      key={item.label}
      className="context-item"
      disabled={item.disabled}
      onClick={() => item.onSelect?.()}
    >
      {item.label}
    </Base.Item>
  );
}
