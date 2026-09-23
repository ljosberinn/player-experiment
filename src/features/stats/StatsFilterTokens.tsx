import { Icon } from "../../components/icons/Icon";
import { usePlaylistsStore } from "../playlists/store";
import { activeFilters } from "./filters";
import type { StatsTab } from "./path";
import { useStatsStore } from "./store";

/**
 * What the open tab is filtered to, as a sentence, under the bar that set it.
 *
 * Section 4b's lower drawing. The sheet draws it in the same frame as the
 * selects with the bar's rule between them, so this is a line under the bar
 * rather than a second form of it - and the two disagree in the sheet only
 * because a line that draws nothing at the defaults cannot be drawn on a
 * specimen sheet.
 *
 * No "+ add filter". Every facet a tab has is a select above this line and
 * always reachable, so the chip would open a menu of controls already on
 * screen. It wants a facet the bar cannot express, and there is none today.
 *
 * Nothing filtered draws nothing at all: "Showing" with no tokens after it is
 * a sentence that stops halfway.
 */
export function StatsFilterTokens({ tab }: { tab: StatsTab }) {
  const filters = useStatsStore((s) => s.filters);
  const setFilters = useStatsStore((s) => s.setFilters);
  const playlists = usePlaylistsStore((s) => s.playlists);

  const active = activeFilters(filters, tab, playlists);
  if (active.length === 0) {
    return null;
  }

  return (
    <div className="filter-tokens">
      Showing
      {active.map(({ facet, phrase, cleared }) => (
        <span key={facet} className="filter-token">
          {phrase}
          {/* A bare button rather than an `IconButton`: that component's sizes
              are four places the sheet states, and a chip is not one of them -
              a square box around this glyph would be taller than the chip. */}
          <button type="button" aria-label={`Clear ${phrase}`} onClick={() => setFilters(cleared)}>
            <Icon name="remove" size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}
