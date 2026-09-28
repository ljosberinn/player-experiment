import { useLibraryStore } from "../library/store";
import { DEFAULT_FILTERS, type StatsFilters } from "./filters";
import type { StatsPath } from "./path";
import { dayKey, periodLabel } from "./series";
import { useStatsStore } from "./store";

/** Past this many days a play is named by its date. */
const RELATIVE_DAYS = 30;

/**
 * When `at` was, relative to `now`: `today`, `yesterday`, `3 days ago`, then
 * the date as the breadcrumb spells a day.
 *
 * Counted in local calendar days rather than elapsed hours, so a play at
 * 23:50 is yesterday ten minutes later.
 */
export function lastPlayedWords(at: number, now: Date): string {
  const played = new Date(at * 1000);
  // Rounded: a span crossing a daylight-saving change is 23 or 25 hours.
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(played.getFullYear(), played.getMonth(), played.getDate()).getTime()) /
      86_400_000,
  );
  if (days <= 0) {
    return "today";
  }
  if (days === 1) {
    return "yesterday";
  }
  if (days <= RELATIVE_DAYS) {
    return `${days} days ago`;
  }
  return periodLabel(lastPlayDay(at));
}

/** Statistics › Listening, drilled into the local day of `at`. */
export function lastPlayPath(at: number): StatsPath {
  return { tab: "listening", crumbs: [{ kind: "period", key: lastPlayDay(at) }] };
}

function lastPlayDay(at: number): string {
  return `${dayKey(new Date(at * 1000))}/day`;
}

/** The Listening filters at their defaults; the Library tab's are left alone. */
const LISTENING_DEFAULTS: Partial<StatsFilters> = {
  range: DEFAULT_FILTERS.range,
  custom: DEFAULT_FILTERS.custom,
  owned: DEFAULT_FILTERS.owned,
  loved: DEFAULT_FILTERS.loved,
};

/**
 * Opens `lastPlayPath(at)` with the Listening filters cleared.
 *
 * A period crumb narrows the stored range rather than replacing it, so a
 * *Last 7 days* left on would empty an older day, and *Owned* or *Loved* can
 * hide the song itself.
 */
export async function showLastPlay(at: number): Promise<void> {
  const stats = useStatsStore.getState();
  // Read first: `setFilters` stores the whole set, and before the read that
  // set is the defaults, Library tab and all.
  await stats.load();
  stats.setFilters(LISTENING_DEFAULTS);
  await useLibraryStore.getState().showStatsPath(lastPlayPath(at));
}
