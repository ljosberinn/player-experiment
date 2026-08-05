import type { ReactNode } from "react";

/**
 * The source list.
 *
 * Chrome only since phase 35. It used to take the fixed sources as data and
 * render them itself, which was one item - "Music" - and a shape built for more.
 * Everything in the sidebar now has behaviour of its own: the library views
 * switch the content pane, the playlists rename, delete and take drops. All of
 * them render through `children` and own that behaviour themselves.
 */
export function Sidebar({ children }: { children?: ReactNode }) {
  return (
    <nav className="sidebar" aria-label="Library">
      {children}
    </nav>
  );
}
