/**
 * The source list.
 *
 * Only Music exists today; playlists join it in phase 6, which is why the
 * sections are already modelled as data rather than hard-coded markup.
 */
export interface SidebarSection {
  title: string;
  items: SidebarItem[];
}

export interface SidebarItem {
  id: string;
  label: string;
  icon?: string;
}

export function Sidebar({
  sections,
  selectedId,
  onSelect,
}: {
  sections: SidebarSection[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="sidebar" aria-label="Library">
      {sections.map((section) => (
        <div className="sidebar-section" key={section.title}>
          <h2 className="sidebar-title">{section.title}</h2>
          <ul>
            {section.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="sidebar-item"
                  aria-current={item.id === selectedId ? "page" : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  {item.icon ? (
                    <span className="sidebar-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                  ) : null}
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
