import type { ReactNode } from "react";

/**
 * The source list.
 *
 * Sections passed as data cover the fixed sources (Library); anything with
 * behaviour of its own - playlists, with their renaming, deleting and drop
 * targets - renders through `children` and owns that behaviour itself.
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
  children,
}: {
  sections: SidebarSection[];
  selectedId: string;
  onSelect: (id: string) => void;
  children?: ReactNode;
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
      {children}
    </nav>
  );
}
