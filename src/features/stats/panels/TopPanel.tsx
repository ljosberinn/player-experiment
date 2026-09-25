import { useState } from "react";
import { BarList } from "../../../components/charts/BarList";
import { type ListenDimension, statsTop } from "../../../ipc";
import { useLibraryStore } from "../../library/store";
import { deepestCrumb } from "../filters";
import { listenTotalsOnce } from "../listenTotals";
import { drill, type StatsCrumb, walkBack } from "../path";
import { useListenQuery } from "../useListenQuery";
import { usePanelQuery } from "../usePanelQuery";
import { AlbumLinkDialog } from "./AlbumLinkDialog";
import { StatsPanel } from "./StatsPanel";

/** How many rows a top list draws. Ten is what fits without a scrollbar. */
const ROWS = 10;

const TITLES: Record<ListenDimension, string> = {
  artist: "Top artists",
  album: "Top albums",
  track: "Top tracks",
  genre: "Top genres",
};

/**
 * Which drill-down a row opens, where it opens one.
 *
 * A track has no entry because `ListenQuery` has no track field: every
 * `StatsCrumb` kind is a field the query honours, and a track crumb would be
 * one it cannot.
 */
const DRILLS: Partial<Record<ListenDimension, StatsCrumb["kind"]>> = {
  artist: "artist",
  album: "album",
  genre: "genre",
};

export interface TopPanelProps {
  readonly dimension: ListenDimension;
}

/**
 * The most played artists, albums, tracks or genres, as a bar list.
 *
 * One component for all four: the answer has the same shape each time, and
 * four near-identical panels would be four places to fix a drill-down.
 *
 * Subscribes to the filters and the drill path itself - `App` and
 * `StatisticsView` must not re-render because a range changed.
 */
export function TopPanel({ dimension }: TopPanelProps) {
  const path = useLibraryStore((s) => s.statsPath);
  const showStatsPath = useLibraryStore((s) => s.showStatsPath);
  const [fixing, setFixing] = useState(false);

  const { query, deps } = useListenQuery();
  const { data, loading } = usePanelQuery(
    () => statsTop(query, dimension, ROWS),
    [...deps, dimension],
  );

  // Only for the genre panel, and only because genre is knowable for a matched
  // play alone: reporting the matched subset as the whole is the failure mode
  // the plan names, so the panel says what it covers instead.
  const coverage = usePanelQuery(
    () => (dimension === "genre" ? listenTotalsOnce(query) : Promise.resolve(null)),
    [...deps, dimension],
  );

  const kind = DRILLS[dimension];
  // Opened on the drilled album rather than on a row, the way `GenreDonut`
  // opens on the drilled genre: a grouping that reads wrong is noticed from
  // inside the album it is wrong about, and a row already spends its click on
  // getting there.
  const album = dimension === "album" ? deepestCrumb(path, "album") : null;

  return (
    <StatsPanel
      title={TITLES[dimension]}
      {...(album !== null
        ? {
            action: (
              <button type="button" className="stats-action" onClick={() => setFixing(true)}>
                Fix the grouping…
              </button>
            ),
          }
        : {})}
    >
      <BarList
        entries={(data ?? []).map((entry) => ({ ...entry, value: entry.plays }))}
        format={(plays) => plays.toLocaleString()}
        empty="Nothing in this range."
        loading={loading}
        {...(kind !== undefined && path !== null
          ? { onSelect: (entry) => void showStatsPath(drill(path, { kind, key: entry.key })) }
          : {})}
        {...(coverage.data !== null && coverage.data.plays > 0
          ? {
              caption: `Genre known for ${Math.round(
                (coverage.data.withGenre / coverage.data.plays) * 100,
              )}% of plays.`,
            }
          : {})}
      />
      {fixing && album !== null && (
        <AlbumLinkDialog
          heading={album}
          onClose={() => setFixing(false)}
          // A retitle leaves the crumb naming a heading nothing reads under,
          // which is an empty tab. Walking out and back in on the new name is
          // one navigation, so Back still leaves the album rather than
          // stepping through the rename.
          onRenamed={(heading) =>
            void showStatsPath(
              drill(walkBack(path ?? { tab: "listening", crumbs: [] }, depthOf(path, album)), {
                kind: "album",
                key: heading,
              }),
            )
          }
        />
      )}
    </StatsPanel>
  );
}

/** Where the album crumb sits, so the path can be rebuilt without it. */
function depthOf(path: { crumbs: readonly StatsCrumb[] } | null, album: string): number {
  if (path === null) {
    return 0;
  }
  const at = path.crumbs.findIndex((crumb) => crumb.kind === "album" && crumb.key === album);
  return at === -1 ? path.crumbs.length : at;
}
