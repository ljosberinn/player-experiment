import { MenuBar } from "../../components/ui/MenuBar";
import { type MenuWiring, useMenus } from "./useMenus";

/**
 * The menu bar's contents, subscribed on their own behalf.
 *
 * The Edit menu serves the selection, so `menus()` has to be rebuilt on every
 * click, every shift-range and every Ctrl+A. Built in `App` that woke the whole
 * tree - the sidebar, the transport strip, the footer, none of which want
 * anything from the selection - so it is built here instead, where a click
 * re-renders one component that draws five triggers.
 *
 * `memo(SongTable)` is still not the answer and cannot be: the table subscribes
 * to `selection` itself, so it renders once per click whatever this file does.
 * What this saves is everything else.
 *
 * `MenuBar` below stays presentational: it knows how a menu opens, not what is
 * in one.
 */
export function AppMenus(wiring: MenuWiring) {
  return <MenuBar menus={useMenus(wiring)} />;
}
