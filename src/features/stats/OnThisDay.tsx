import { useState } from "react";
import { type Play, statsRecentPlays } from "../../ipc";
import { dayRange, earlierYears } from "./filters";
import { PlayRowContent, playTime } from "./panels/PlayRowContent";
import { StatsPanel } from "./panels/StatsPanel";
import { useStatsStore } from "./store";
import { usePanelQuery } from "./usePanelQuery";

/** The backend's `MAX_LIMIT` (db/query.rs): a year's day that fills it may hold more. */
const MAX_PLAYS = 1000;

interface YearOfPlays {
  readonly year: number;
  readonly plays: readonly Play[];
}

/**
 * What was played on today's date in earlier years, a section per year.
 *
 * One request per year rather than one scan for the month and day: each is a
 * range on the play log's time index, and matching a day across years in SQL
 * reads every play. The years run from the first a play can be dated in rather
 * than from the history's first play, because `listenTotalsOnce` is the
 * dearest aggregate in the set and answers from its cache only for the exact
 * query it was last asked.
 *
 * Subscribes to Owned and Loved alone: the day is this tab's range and it has
 * no drill path, so `useListenQuery`'s deps would refetch it for nothing.
 */
export function OnThisDay() {
  const owned = useStatsStore((s) => s.filters.owned);
  const loved = useStatsStore((s) => s.filters.loved);
  // Read once: a tab left open past midnight keeps the day it opened on.
  const [today] = useState(() => new Date());
  const month = today.getMonth();
  const day = today.getDate();

  const { data } = usePanelQuery(
    () =>
      Promise.all(
        earlierYears(today).map(
          async (year): Promise<YearOfPlays> => ({
            year,
            plays: await statsRecentPlays(
              {
                range: dayRange(year, month, day),
                artist: null,
                genre: null,
                album: null,
                owned,
                loved,
              },
              0,
              MAX_PLAYS,
            ),
          }),
        ),
      ),
    [today, owned, loved],
  );

  if (data === null) {
    return null;
  }

  const years = data.filter((entry) => entry.plays.length > 0);
  if (years.length === 0) {
    const named = today.toLocaleDateString(undefined, { day: "numeric", month: "long" });
    return <p className="empty-state">{`Nothing played on ${named} in earlier years.`}</p>;
  }

  return years.map(({ year, plays }) => {
    const ago = today.getFullYear() - year;
    const date = new Date(year, month, day).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const cut = plays.length >= MAX_PLAYS;
    return (
      <StatsPanel
        key={year}
        title={`${ago} ${ago === 1 ? "year" : "years"} ago · ${date}`}
        action={<span className="on-this-day-count">{count(plays.length, cut)}</span>}
        caption={cut ? `Cut at the day's last ${MAX_PLAYS.toLocaleString()} plays.` : null}
      >
        <ol className="on-this-day-plays">
          {plays.map((play) => (
            <li key={play.id} className="on-this-day-row">
              <PlayRowContent
                play={play}
                when={play.startedAt === null ? "" : playTime(new Date(play.startedAt * 1000))}
              />
            </li>
          ))}
        </ol>
      </StatsPanel>
    );
  });
}

function count(plays: number, cut: boolean): string {
  if (cut) {
    return `${plays.toLocaleString()}+ plays`;
  }
  return `${plays.toLocaleString()} ${plays === 1 ? "play" : "plays"}`;
}
