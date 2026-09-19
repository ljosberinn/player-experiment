import { statsFirsts, statsPlaysOverTime } from "../../ipc";
import { useLibraryStore } from "../library/store";
import { ListeningTiles } from "./ListeningTiles";
import { HeardNeverOwned } from "./panels/HeardNeverOwned";
import { RecentPlays } from "./panels/RecentPlays";
import { SeriesPanel } from "./panels/SeriesPanel";
import { StreakTiles } from "./panels/StreakTiles";
import { TopPanel } from "./panels/TopPanel";
import { WeekClock } from "./panels/WeekClock";

/**
 * What the Listening tab draws, and what it stops drawing once drilled in.
 *
 * **An artist bar narrows this tab rather than opening a page of its own.**
 * The crumb already reaches `ListenQuery` through `listenQuery`, so every
 * panel below re-queries narrowed without knowing a drill-down happened; the
 * only thing that changes is the list. A separate artist page would have been
 * a second component tree and a second set of loaders drawing the same six
 * aggregates under one extra filter.
 *
 * Subscribes to the path alone. The filters are each panel's own business, so
 * a range change wakes the panels and not this.
 */
export function ListeningPanels() {
  const crumbs = useLibraryStore((s) => s.statsPath?.crumbs ?? EMPTY);

  // An artist's top artist is themselves, and an album's is whoever made it.
  const inArtist = crumbs.some((crumb) => crumb.kind === "artist");
  // Either way the new artists are one artist, once.
  const inAlbum = crumbs.some((crumb) => crumb.kind === "album");

  return (
    <>
      <ListeningTiles />
      <StreakTiles />
      <SeriesPanel
        title="Plays over time"
        aggregate={statsPlaysOverTime}
        noun="Plays"
        whole="plays"
      />
      {!inArtist && !inAlbum && (
        <SeriesPanel title="New artists" aggregate={statsFirsts} noun="Artists" whole="artists" />
      )}
      <WeekClock />
      {!inArtist && <TopPanel dimension="artist" />}
      <TopPanel dimension="album" />
      <TopPanel dimension="track" />
      {/* Kept while drilled in: an artist's genres are a fair question, and
          the caption says how much of their plays it covers. */}
      <TopPanel dimension="genre" />
      <HeardNeverOwned />
      <RecentPlays />
    </>
  );
}

/** One array, so the selector above is referentially stable when unset. */
const EMPTY: never[] = [];
