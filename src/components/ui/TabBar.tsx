import { Tabs } from "@base-ui/react/tabs";
import type { ViewTab } from "../../features/library/store";

/**
 * The capsule segmented control under the toolbar.
 *
 * The type is imported rather than declared here because which tab is open is
 * store state now, not this component's: switching tabs re-runs the query, so
 * the store has to own it.
 */
const TABS: { id: ViewTab; label: string }[] = [
  { id: "songs", label: "Songs" },
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
  { id: "genres", label: "Genres" },
];

export type { ViewTab };

/**
 * `role="tablist"` was already here; the arrow keys a tablist owes the user
 * were not. These were four buttons that said they were tabs. Base UI's `Tabs`
 * is the same markup with the behaviour attached - Left/Right move, Home/End
 * reach the ends, and one tab stop holds the group instead of four.
 */
export function TabBar({
  active,
  onChange,
}: {
  active: ViewTab;
  onChange: (tab: ViewTab) => void;
}) {
  return (
    // Controlled, and with no panels: the "panel" is the whole content area,
    // which the store renders from this same state.
    <Tabs.Root value={active} onValueChange={(value) => onChange(value as ViewTab)}>
      <Tabs.List className="tabbar" aria-label="View">
        {TABS.map((tab) => (
          <Tabs.Tab key={tab.id} value={tab.id} className="tab">
            {tab.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
