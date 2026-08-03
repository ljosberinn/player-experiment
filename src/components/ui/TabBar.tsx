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

export function TabBar({
  active,
  onChange,
}: {
  active: ViewTab;
  onChange: (tab: ViewTab) => void;
}) {
  return (
    <div className="tabbar" role="tablist" aria-label="View">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className="tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
