/**
 * The capsule segmented control under the toolbar.
 *
 * Only Songs is implemented; the rest are declared so the chrome matches the
 * reference layout and later phases have somewhere to land.
 */
export type ViewTab = "songs" | "albums" | "artists" | "genres";

const TABS: { id: ViewTab; label: string; enabled: boolean }[] = [
  { id: "songs", label: "Songs", enabled: true },
  { id: "albums", label: "Albums", enabled: false },
  { id: "artists", label: "Artists", enabled: false },
  { id: "genres", label: "Genres", enabled: false },
];

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
          disabled={!tab.enabled}
          title={tab.enabled ? undefined : "Not implemented yet"}
          className="tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
