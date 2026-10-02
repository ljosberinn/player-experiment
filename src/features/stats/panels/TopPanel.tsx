import { useState } from "react";
import { BarList } from "../../../components/charts/BarList";
import { type ListenDimension, statsTop } from "../../../ipc";
import { formatSpan } from "../../../lib/format";
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

  const rows = data ?? [];
  const caption = [
    coverage.data !== null && coverage.data.plays > 0
      ? `Genre known for ${Math.round((coverage.data.withGenre / coverage.data.plays) * 100)}% of plays.`
      : null,
    timing(rows),
  ]
    .filter((sentence) => sentence !== null)
    .join(" ");

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
        entries={rows.map((entry) => ({
          ...entry,
          value: entry.plays,
          // A row heard only through last.fm has plays and no time, which is
          // not "0 minutes".
          ...(entry.timed > 0 ? { detail: formatSpan(entry.durationMs) } : {}),
        }))}
        format={(plays) => plays.toLocaleString()}
        empty="Nothing in this range."
        loading={loading}
        {...(kind !== undefined && path !== null
          ? { onSelect: (entry) => void showStatsPath(drill(path, { kind, key: entry.key })) }
          : {})}
        {...(caption !== "" ? { caption } : {})}
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

/**
 * What share of the drawn rows' plays their times cover, where that is not all.
 *
 * Over the rows rather than `listen_totals`: the range's share is the tile's,
 * and genre rows are matched plays, so nearly always fully timed whatever the
 * range is. Floored so that a row short by one play never reads 100%.
 */
function timing(rows: readonly { plays: number; timed: number }[]): string | null {
  const plays = rows.reduce((sum, row) => sum + row.plays, 0);
  const timed = rows.reduce((sum, row) => sum + row.timed, 0);
  return timed < plays
    ? `Time known for ${Math.floor((timed / plays) * 100)}% of these plays.`
    : null;
}

/** Where the album crumb sits, so the path can be rebuilt without it. */
function depthOf(path: { crumbs: readonly StatsCrumb[] } | null, album: string): number {
  if (path === null) {
    return 0;
  }
  const at = path.crumbs.findIndex((crumb) => crumb.kind === "album" && crumb.key === album);
  return at === -1 ? path.crumbs.length : at;
}
