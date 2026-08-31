import { MenuBar } from "../../components/ui/MenuBar";
import type { ExportChoice } from "../export/scope";
import { useAppMenus } from "./useAppMenus";

/**
 * The menu bar, and the store subscriptions its items are built from.
 *
 * A component rather than a bare `useAppMenus()` call in `App`, because a hook
 * subscribes on behalf of whoever calls it: read from the top, the selection -
 * which the Edit menu is made of, and which changes on every click and every
 * row a shift-drag crosses - re-rendered the entire app.
 */
export function AppMenuBar({
  onExport,
  onRemoveMissing,
  onSettings,
}: {
  onExport: (choice: ExportChoice) => void;
  onRemoveMissing: () => void;
  onSettings: () => void;
}) {
  return <MenuBar menus={useAppMenus({ onExport, onRemoveMissing, onSettings })} />;
}
