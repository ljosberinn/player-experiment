/**
 * Where the Statistics view is pointed, as one value.
 *
 * The tab is the root of the path rather than state beside it: held apart it
 * would be the one navigation Back does not walk, and a drill-down would not
 * carry the tab it belongs to.
 */
export type StatsTab = "listening" | "library";

/** One step of a drill-down: the slice, bar or row that was clicked. */
export interface StatsCrumb {
  readonly kind: "artist" | "genre" | "album";
  readonly key: string;
}

export interface StatsPath {
  readonly tab: StatsTab;
  readonly crumbs: readonly StatsCrumb[];
}

export const STATS_TAB_TITLES: Record<StatsTab, string> = {
  listening: "Listening",
  library: "Library",
};

/** A tab with nothing drilled into - what clicking Statistics lands on. */
export function statsRoot(tab: StatsTab): StatsPath {
  return { tab, crumbs: [] };
}

/** One step deeper: a genre's children, an artist's page. */
export function drill(path: StatsPath, crumb: StatsCrumb): StatsPath {
  return { tab: path.tab, crumbs: [...path.crumbs, crumb] };
}

/**
 * The path as it was `depth` crumbs in, for the breadcrumb.
 *
 * Back through history would do the same thing one step at a time; a crumb
 * three levels up is one navigation, and clicking it three times is not.
 */
export function walkBack(path: StatsPath, depth: number): StatsPath {
  return { tab: path.tab, crumbs: path.crumbs.slice(0, depth) };
}

export function sameStatsPath(a: StatsPath | null, b: StatsPath | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.tab === b.tab &&
    a.crumbs.length === b.crumbs.length &&
    a.crumbs.every((crumb, index) => {
      const other = b.crumbs[index];
      return other !== undefined && crumb.kind === other.kind && crumb.key === other.key;
    })
  );
}
