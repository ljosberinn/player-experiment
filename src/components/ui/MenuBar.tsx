import { Menu } from "@base-ui/react/menu";
import { Menubar } from "@base-ui/react/menubar";
import type { Menu as MenuModel } from "../../features/shell/menus";
import { renderMenuItem } from "./ContextMenu";

/**
 * The application menu bar.
 *
 * Base UI's `Menubar` rather than a row of popovers, for the same reason phase
 * 24 replaced the hand-rolled context menu: a menu bar owes the user roving
 * focus across the top level, Left/Right between open menus, typeahead, Escape,
 * and submenus that survive a diagonal pointer path. All of that is behaviour,
 * none of it is ours to invent, and the last attempt at inventing part of it
 * cost a phase.
 *
 * Items are drawn by `renderMenuItem`, the same function the right-click menu
 * uses - every Base UI part below the trigger is literally the same component
 * in both namespaces. What each menu *contains* comes from `menus()`, which is
 * pure. This file knows only how a menu opens.
 */
export function MenuBar({ menus }: { menus: MenuModel[] }) {
  return (
    <Menubar className="menubar">
      {menus.map((menu) => (
        <Menu.Root key={menu.label}>
          {/* A menu with nothing in it is shown and cannot be opened, rather
              than hidden. Account is empty until last.fm arrives, and a bar
              that grows an entry later is a bar that moves under the pointer
              of someone who had learned where Help was. */}
          <Menu.Trigger className="menubar-trigger" disabled={menu.disabled}>
            {menu.label}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="context-positioner" sideOffset={4} align="start">
              <Menu.Popup className="context-menu" aria-label={menu.label}>
                {menu.items.map(renderMenuItem)}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      ))}
    </Menubar>
  );
}
