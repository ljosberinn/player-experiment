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
      /**
       * Why this entry is greyed, in a few words.
       *
       * Real text in the item rather than a tooltip, so a screen reader reads
       * it with the label and a disabled entry never leaves the user guessing
       * what would un-grey it. Short: it shares the row with the label.
       */
      hint?: string | undefined;
      /**
       * The keystroke that does the same thing, written as the user's keyboard
       * has it - `Ctrl+I`, `Del`.
       *
       * Only where a binding really exists. A menu that names a chord nothing
       * listens for is worse than one that names none, and the specimen
       * sheet's own `Ctrl+E` on Show in Explorer is one of those.
       */
      shortcut?: string | undefined;
      submenu?: MenuItem[] | undefined;
    };

/**
 * The ARIA spelling of a shortcut, from the one the menu prints.
 *
 * `aria-keyshortcuts` has a vocabulary - modifiers spelled out, the key last -
 * and it is not what a Windows menu prints. Drawing one and announcing the
 * other keeps the accessible name of an item its label, which is what every
 * test and every screen reader looks it up by.
 */
function keyshortcuts(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => (part === "Ctrl" ? "Control" : part === "Del" ? "Delete" : part))
    .join("+");
}

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
          <Base.Positioner className="menu-positioner">
            <Base.Popup className="menu-popup" aria-label={label}>
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
    return <Base.Separator key={`sep-${index}`} className="menu-separator" />;
  }

  if (item.submenu) {
    return (
      <Base.SubmenuRoot key={item.label}>
        <Base.SubmenuTrigger className="menu-item has-submenu" disabled={item.disabled}>
          <span className="menu-label">{item.label}</span>
          <span className="menu-arrow" aria-hidden="true">
            ▸
          </span>
        </Base.SubmenuTrigger>
        <Base.Portal>
          <Base.Positioner className="menu-positioner">
            <Base.Popup className="menu-popup" aria-label={item.label}>
              {item.submenu.length === 0 ? (
                // A submenu that renders nothing looks broken; this explains it.
                <div className="menu-empty">No playlists yet</div>
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
      className="menu-item"
      disabled={item.disabled}
      aria-keyshortcuts={item.shortcut === undefined ? undefined : keyshortcuts(item.shortcut)}
      // Spelled out rather than left to the two text nodes: the accessible
      // name is their concatenation with no separator, so a hinted entry would
      // otherwise be announced as "LoveNo artist and title".
      aria-label={item.hint === undefined ? undefined : `${item.label}. ${item.hint}`}
      onClick={() => item.onSelect?.()}
    >
      <span className="menu-label">{item.label}</span>
      {item.hint === undefined ? null : <span className="menu-hint">{item.hint}</span>}
      {item.shortcut === undefined ? null : (
        // Announced by `aria-keyshortcuts` above rather than read out of the
        // row, so the item is still named after what it does.
        <span className="menu-shortcut" aria-hidden="true">
          {item.shortcut}
        </span>
      )}
    </Base.Item>
  );
}
