import { VIEW_TITLES, type ViewTab } from "../../features/library/store";
import { Icon } from "../icons/Icon";

/**
 * The LIBRARY section of the source list: Songs, Releases, Artists, Genres.
 *
 * These were a segmented tab bar above the table until phase 35. The design puts
 * them in the sidebar with the playlists, which is where they belong: switching
 * between Songs and Releases is the same kind of act as opening a playlist, and
 * having two controls that both choose what the content pane shows meant the
 * selected playlist and the selected tab were highlighted in different places.
 *
 * Buttons rather than tabs, for the same reason. A tablist owns arrow-key
 * movement between its tabs, which would have been wrong the moment these sat in
 * a list next to the playlists - the arrows have to walk the whole sidebar.
 */
/** The sidebar's icon box, which `.sidebar-icon` sizes to match. */
const ICON_SIZE = 15;

/** Order only; the words are `VIEW_TITLES`, which the history arrows share. */
const VIEWS: ViewTab[] = ["songs", "albums", "artists", "genres"];

export function LibraryNav({
  active,
  onSelect,
}: {
  /** The open view, or null while a playlist is showing. */
  active: ViewTab | null;
  onSelect: (view: ViewTab) => void;
}) {
  return (
    <div className="sidebar-section">
      <h2 className="sidebar-title">Library</h2>
      <ul>
        {VIEWS.map((view) => (
          <li key={view}>
            <button
              type="button"
              className="sidebar-item"
              aria-current={view === active ? "page" : undefined}
              onClick={() => onSelect(view)}
            >
              <Icon name={view} size={ICON_SIZE} className="sidebar-icon" />
              <span className="sidebar-label">{VIEW_TITLES[view]}</span>
            </button>
          </li>
        ))}

        {/* Shown and unopenable, which is how the design draws it. Hiding it
            until it works would move every playlist below it down the day it
            arrives; leaving it out entirely would lose the placeholder the
            design asks for. */}
        <li>
          <button type="button" className="sidebar-item" disabled title="Not available yet">
            <Icon name="statistics" size={ICON_SIZE} className="sidebar-icon" />
            <span className="sidebar-label">Statistics</span>
          </button>
        </li>
      </ul>
    </div>
  );
}
