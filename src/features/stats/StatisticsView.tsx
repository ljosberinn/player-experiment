import { Tabs } from "@base-ui/react/tabs";
import { useEffect } from "react";
import { useLibraryStore } from "../library/store";
import { LibraryPanels } from "./LibraryPanels";
import { ListeningPanels } from "./ListeningPanels";
import { STATS_TAB_TITLES, type StatsTab, statsRoot, walkBack } from "./path";
import { StatsFilterBar } from "./StatsFilterBar";
import { StatsFilterTokens } from "./StatsFilterTokens";
import { useStatsStore } from "./store";

/**
 * The Statistics view: two tabs, a filter bar that follows them, and the
 * panels underneath.
 *
 * Takes no props. `App` branches on the tab it already subscribes to and
 * renders this; everything it draws subscribes on its own behalf, so a range
 * change wakes a panel and nothing above it.
 *
 * Two tabs because the two questions have nothing in common but a chart
 * library: Listening is what you have heard, Library is what you own.
 */
export function StatisticsView() {
  const path = useLibraryStore((s) => s.statsPath);
  const showStatsPath = useLibraryStore((s) => s.showStatsPath);
  const loadFilters = useStatsStore((s) => s.load);

  useEffect(() => {
    // Read when the view opens rather than at launch: nothing else in the app
    // wants them, and most sessions never come here.
    void loadFilters();
  }, [loadFilters]);

  // Null only if something navigated here without a path, which nothing does;
  // Listening is the half of this view the rest of the app cannot answer.
  const tab: StatsTab = path?.tab ?? "listening";
  const crumbs = path?.crumbs ?? [];

  return (
    <Tabs.Root
      className="stats-view"
      value={tab}
      // A tab change is a navigation, so it pushes: Back walks out of Library
      // into Listening the way it walks out of Releases into Songs.
      onValueChange={(value) => void showStatsPath(statsRoot(value as StatsTab))}
    >
      <Tabs.List className="stats-tabs" aria-label="Statistics">
        {(Object.keys(STATS_TAB_TITLES) as StatsTab[]).map((value) => (
          <Tabs.Tab key={value} className="stats-tab" value={value}>
            {STATS_TAB_TITLES[value]}
          </Tabs.Tab>
        ))}
      </Tabs.List>

      <StatsFilterBar tab={tab} />
      {/* Above the breadcrumb: both say what narrows the view, and they run
          outermost first - the bar's facets, then the drill path. */}
      <StatsFilterTokens tab={tab} />

      {crumbs.length > 0 && path !== null ? (
        <nav className="stats-breadcrumb" aria-label="Drill-down">
          <button type="button" onClick={() => void showStatsPath(walkBack(path, 0))}>
            {STATS_TAB_TITLES[tab]}
          </button>
          {crumbs.map((crumb, depth) => (
            <button
              key={`${crumb.kind}:${crumb.key}`}
              type="button"
              // The last crumb is where the view already is.
              disabled={depth === crumbs.length - 1}
              onClick={() => void showStatsPath(walkBack(path, depth + 1))}
            >
              {crumb.key}
            </button>
          ))}
        </nav>
      ) : null}

      {/* Unmounted rather than hidden while inactive, which is Base UI's
          default and what keeps the tab you are not looking at from querying. */}
      <Tabs.Panel className="stats-panels" value="listening">
        <ListeningPanels />
      </Tabs.Panel>
      <Tabs.Panel className="stats-panels" value="library">
        <LibraryPanels />
      </Tabs.Panel>
    </Tabs.Root>
  );
}
