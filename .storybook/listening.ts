import { useLibraryStore } from "../src/features/library/store";
import { useLovedStore } from "../src/features/love/store";
import { DEFAULT_FILTERS, type StatsFilters } from "../src/features/stats/filters";
import { drill, type StatsCrumb, statsRoot } from "../src/features/stats/path";
import { useStatsStore } from "../src/features/stats/store";
import type {
  AlbumGroup,
  AlbumNeighbour,
  ListenDimension,
  ListenQuery,
  ListenTotals,
  NewArtist,
  Play,
  Streaks,
  TimeBucket,
  TimeCount,
  TopEntry,
  Track,
} from "../src/ipc";
import { LIBRARY } from "./fixtures";
import { lineage } from "./library";

/**
 * The Listening tab's aggregates, over a play log generated from `LIBRARY`.
 *
 * The log ends today rather than on a fixed date: the ranges are cut from the
 * clock and the current streak is a run ending today, so a history that ended
 * on a fixture date would draw every preset range and the streak empty.
 * Everything else about it is fixed - a seeded generator, so the same day
 * draws the same log.
 */

/**
 * A story's `beforeEach`: the Listening tab, under `filters` and drilled into
 * `crumb`, through the navigation the app uses.
 */
export async function openListening(
  filters: Partial<StatsFilters> = {},
  crumb: StatsCrumb | null = null,
): Promise<void> {
  useStatsStore.setState({ filters: { ...DEFAULT_FILTERS, ...filters } });
  const root = statsRoot("listening");
  await useLibraryStore.getState().showStatsPath(crumb === null ? root : drill(root, crumb));
}

/** A play as the log holds it: the `Play` the panels read, and what its file says. */
interface Heard extends Play {
  readonly track: Track | null;
}

/** Something heard that no file in `LIBRARY` is, for *Heard, never owned*. */
interface Unowned {
  readonly artist: string;
  readonly album: string;
  readonly titles: readonly string[];
}

const UNOWNED: Unowned[] = [
  { artist: "Cassia Vale", album: "Low Orbit", titles: ["Apogee", "Tether", "Re-entry"] },
  { artist: "Brother Hollis", album: "Porch Light", titles: ["Screen Door", "Cicadas"] },
  // An owned artist's bonus track, which the files never had.
  { artist: "The Lanterns", album: "Harbour Lights (Deluxe Edition)", titles: ["Lanternfish"] },
];

/**
 * Spellings the fold reads as another album. Harbour Lights was scrobbled
 * under its deluxe title for a while, which is what the grouping dialog is
 * for.
 */
const FOLDED: Record<string, string> = { "Harbour Lights (Deluxe Edition)": "Harbour Lights" };

/** How far back the log reaches, and the days at its end with no gap in them. */
const HISTORY_DAYS = 540;
const UNBROKEN_DAYS = 16;
/** Plays imported before last.fm kept dates. */
const UNDATED = 24;

/** When each album was first heard, in days after the log opens, so the new-artists series has a shape. */
const DISCOVERED: Record<string, number> = {
  "Harbour Lights": 0,
  "Demos 2008": 20,
  "Night Transit": 70,
  "Harbour Lights (Deluxe Edition)": 110,
  "Field Recordings, Vol. 2": 160,
  "Low Orbit": 230,
  Copper: 300,
  "Porch Light": 380,
  "Glass Garden": 450,
};

/** Evenings busy, small hours empty. */
const HOUR_WEIGHTS = [1, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 3, 2, 2, 2, 3, 4, 5, 6, 7, 7, 5, 3];

/** mulberry32: small, seeded, and the same sequence on every machine. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pickHour(random: () => number): number {
  const total = HOUR_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  let at = random() * total;
  for (const [hour, weight] of HOUR_WEIGHTS.entries()) {
    at -= weight;
    if (at < 0) {
      return hour;
    }
  }
  return 21;
}

type Source = { artist: string; album: string; title: string; track: Track | null };

/** Shuffled once, so the squared pick below favours tracks across albums rather than the first album. */
function shuffled<T>(items: T[], random: () => number): T[] {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as T, order[i] as T];
  }
  return order;
}

const OWNED_SOURCES: Source[] = LIBRARY.map((track) => ({
  artist: track.artist as string,
  album: track.album as string,
  title: track.title as string,
  track,
}));

const UNOWNED_SOURCES: Source[] = UNOWNED.flatMap(({ artist, album, titles }) =>
  titles.map((title) => ({ artist, album, title, track: null })),
);

/** A share of plays with no file behind them. */
const UNOWNED_SHARE = 0.15;

function generate(): Heard[] {
  const random = seeded(146);
  const owned = shuffled(OWNED_SOURCES, random);
  const today = new Date();
  const heard: Omit<Heard, "id">[] = [];

  for (let back = HISTORY_DAYS - 1; back >= 0; back -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const since = HISTORY_DAYS - 1 - back;
    if (back >= UNBROKEN_DAYS && random() < 0.18) {
      continue;
    }
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const discovered = (source: Source) => (DISCOVERED[source.album] ?? 0) <= since;
    const knownOwned = owned.filter(discovered);
    const knownUnowned = UNOWNED_SOURCES.filter(discovered);
    const count = 1 + Math.floor(random() * (weekend ? 12 : 6));
    for (let n = 0; n < count; n += 1) {
      const known = knownUnowned.length > 0 && random() < UNOWNED_SHARE ? knownUnowned : knownOwned;
      // Squared, so the front of the list is played far more than the back
      // and the top lists have a ranking rather than a tie.
      const source = known[Math.floor(random() ** 2 * known.length)] as Source;
      const at = new Date(day);
      at.setHours(pickHour(random), Math.floor(random() * 60));
      heard.push({
        startedAt: Math.floor(at.getTime() / 1000),
        artist: source.artist,
        title: source.title,
        // The first Harbour Lights plays are the deluxe spelling, the rest the plain one.
        album:
          source.album === "Harbour Lights" && since < 90 && random() < 0.5
            ? "Harbour Lights (Deluxe Edition)"
            : source.album,
        trackId: source.track?.id ?? null,
        track: source.track,
      });
    }
  }

  // Imported undated, and so older than every dated play. Harbour Lights
  // only, so one artist's first play is the undated kind.
  const first = OWNED_SOURCES.filter((source) => source.album === "Harbour Lights");
  const undated = Array.from({ length: UNDATED }, (_, n) => first[n % first.length] as Source).map(
    (source) => ({
      startedAt: null,
      artist: source.artist,
      title: source.title,
      album: source.album,
      trackId: source.track?.id ?? null,
      track: source.track,
    }),
  );
  return [...undated, ...heard].map((play, index) => ({ ...play, id: index + 1 }));
}

const LOG: Heard[] = generate();

function heading(play: Heard): string | null {
  return play.album === null ? null : (FOLDED[play.album] ?? play.album);
}

function same(a: string | null, b: string): boolean {
  return a !== null && a.toLowerCase() === b.toLowerCase();
}

/** The plays `query` reads. An undated play is outside every range. */
function plays(query: ListenQuery): Heard[] {
  const loved = useLovedStore.getState().loved;
  const { range, artist, album, genre, owned } = query;
  return LOG.filter(
    (play) =>
      (range === null ||
        (play.startedAt !== null && play.startedAt >= range.from && play.startedAt < range.to)) &&
      (artist === null || same(play.artist, artist)) &&
      (album === null || same(heading(play), album)) &&
      (genre === null ||
        (play.track?.genre != null && lineage(play.track.genre).includes(genre))) &&
      (owned === null || (play.trackId !== null) === owned) &&
      (query.loved === null || (play.trackId !== null && loved.has(play.trackId)) === query.loved),
  );
}

function dated(query: ListenQuery): (Heard & { startedAt: number })[] {
  return plays(query).filter(
    (play): play is Heard & { startedAt: number } => play.startedAt !== null,
  );
}

/** `YYYY-MM-DD` in local time, as the backend names a day. */
function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function localDate(unixSeconds: number): Date {
  return new Date(unixSeconds * 1000);
}

/** The first local day of the bucket, Mondays opening a week. */
function bucketKey(unixSeconds: number, bucket: TimeBucket): string {
  const at = localDate(unixSeconds);
  const year = at.getFullYear();
  const month = at.getMonth();
  switch (bucket) {
    case "day":
      return dayKey(new Date(year, month, at.getDate()));
    case "week":
      return dayKey(new Date(year, month, at.getDate() - ((at.getDay() + 6) % 7)));
    case "month":
      return dayKey(new Date(year, month, 1));
    case "year":
      return dayKey(new Date(year, 0, 1));
  }
}

function series(times: number[], bucket: TimeBucket): TimeCount[] {
  const counts = new Map<string, number>();
  for (const time of times) {
    const start = bucketKey(time, bucket);
    counts.set(start, (counts.get(start) ?? 0) + 1);
  }
  return [...counts]
    .map(([start, count]) => ({ start, count }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export function listenTotals({ query }: { query: ListenQuery }): ListenTotals {
  const matched = plays(query);
  const times = dated(query).map((play) => play.startedAt);
  const distinct = (key: (play: Heard) => string | null) =>
    new Set(matched.flatMap((play) => key(play)?.toLowerCase() ?? [])).size;
  const durations = matched.flatMap((play) =>
    play.track?.duration_ms == null ? [] : [play.track.duration_ms],
  );
  return {
    plays: matched.length,
    artists: distinct((play) => play.artist),
    albums: distinct((play) => {
      const album = heading(play);
      return album === null ? null : `${album}\u001f${play.artist}`;
    }),
    tracks: distinct((play) => `${play.artist}\u001f${play.title}`),
    days: new Set(times.map((time) => dayKey(localDate(time)))).size,
    durationMs: durations.reduce((sum, ms) => sum + ms, 0),
    owned: matched.filter((play) => play.trackId !== null).length,
    withGenre: matched.filter((play) => play.track?.genre != null).length,
    timed: durations.length,
    dated: times.length,
    firstAt: times.length === 0 ? null : Math.min(...times),
    lastAt: times.length === 0 ? null : Math.max(...times),
  };
}

const TOP_KEYS: Record<
  ListenDimension,
  (play: Heard) => { group: string; key: string; secondary: string | null } | null
> = {
  artist: (play) => ({ group: play.artist.toLowerCase(), key: play.artist, secondary: null }),
  album: (play) => {
    const album = heading(play);
    return album === null
      ? null
      : { group: `${album}\u001f${play.artist}`.toLowerCase(), key: album, secondary: play.artist };
  },
  track: (play) => ({
    group: `${play.artist}\u001f${play.title}`.toLowerCase(),
    key: play.title,
    secondary: play.artist,
  }),
  genre: (play) => {
    const genre = play.track?.genre ?? null;
    return genre === null ? null : { group: genre, key: genre, secondary: null };
  },
};

export function top({
  query,
  dimension,
  limit,
}: {
  query: ListenQuery;
  dimension: ListenDimension;
  limit: number;
}): TopEntry[] {
  const entries = new Map<string, TopEntry>();
  for (const play of plays(query)) {
    const row = TOP_KEYS[dimension](play);
    if (row !== null) {
      const entry = entries.get(row.group);
      entries.set(row.group, {
        key: row.key,
        secondary: row.secondary,
        plays: (entry?.plays ?? 0) + 1,
      });
    }
  }
  return [...entries.values()]
    .sort((a, b) => b.plays - a.plays || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export function recentPlays({
  query,
  offset,
  limit,
}: {
  query: ListenQuery;
  offset: number;
  limit: number;
}): Play[] {
  return plays(query)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || b.id - a.id)
    .slice(offset, offset + limit)
    .map(({ track: _, ...play }) => play);
}

export function playsOverTime({
  query,
  bucket,
}: {
  query: ListenQuery;
  bucket: TimeBucket;
}): TimeCount[] {
  return series(
    dated(query).map((play) => play.startedAt),
    bucket,
  );
}

/** 168 counts, Monday 00:00 first. */
export function weekClock({ query }: { query: ListenQuery }): number[] {
  const clock = Array.from({ length: 7 * 24 }, () => 0);
  for (const play of dated(query)) {
    const at = localDate(play.startedAt);
    const cell = ((at.getDay() + 6) % 7) * 24 + at.getHours();
    clock[cell] = (clock[cell] ?? 0) + 1;
  }
  return clock;
}

/**
 * The artists whose first play over all time falls in the range, with every
 * play since. An artist first heard undated was not new at their first dated
 * play, so is left out.
 */
function firstHeard(query: ListenQuery): NewArtist[] {
  const first = new Map<string, { artist: string; firstAt: number | null; plays: number }>();
  for (const play of plays({ ...query, range: null })) {
    const key = play.artist.toLowerCase();
    const seen = first.get(key);
    if (seen === undefined) {
      first.set(key, { artist: play.artist, firstAt: play.startedAt, plays: 1 });
      continue;
    }
    seen.plays += 1;
    // The backend's `min()` over the spellings.
    if (play.artist < seen.artist) {
      seen.artist = play.artist;
    }
    if (seen.firstAt !== null && (play.startedAt === null || play.startedAt < seen.firstAt)) {
      seen.firstAt = play.startedAt;
    }
  }
  const { range } = query;
  return [...first.values()].filter(
    (entry): entry is NewArtist =>
      entry.firstAt !== null &&
      (range === null || (entry.firstAt >= range.from && entry.firstAt < range.to)),
  );
}

export function firsts({ query, bucket }: { query: ListenQuery; bucket: TimeBucket }): TimeCount[] {
  return series(
    firstHeard(query).map((entry) => entry.firstAt),
    bucket,
  );
}

export function newArtists({
  query,
  offset,
  limit,
}: {
  query: ListenQuery;
  offset: number;
  limit: number;
}): NewArtist[] {
  return firstHeard(query)
    .sort(
      (a, b) =>
        b.firstAt - a.firstAt || a.artist.toLowerCase().localeCompare(b.artist.toLowerCase()),
    )
    .slice(offset, offset + limit);
}

const DAY_MS = 86_400_000;

/** Days since the epoch in local time, so consecutive days are an integer step. */
function dayNumber(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

export function streaks({ query }: { query: ListenQuery }): Streaks {
  const days = [
    ...new Set(
      dated(query).map((play) => {
        const at = localDate(play.startedAt);
        return dayKey(new Date(at.getFullYear(), at.getMonth(), at.getDate()));
      }),
    ),
  ].sort();
  const today = dayNumber(new Date());
  const result: Streaks = {
    current: 0,
    longest: 0,
    longestFrom: null,
    longestTo: null,
    lastSeven: [false, false, false, false, false, false, false],
  };

  let run = 0;
  let from = "";
  let previous: number | null = null;
  for (const day of days) {
    const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
    const number = dayNumber(new Date(year, month - 1, date));
    if (previous === number - 1) {
      run += 1;
    } else {
      run = 1;
      from = day;
    }
    if (run >= result.longest) {
      result.longest = run;
      result.longestFrom = from;
      result.longestTo = day;
    }
    const index = number - today + 6;
    if (index >= 0 && index < 7) {
      result.lastSeven[index] = true;
    }
    previous = number;
  }
  if (previous !== null && (previous === today || previous === today - 1)) {
    result.current = run;
  }
  return result;
}

/** The spellings reading under `heading`, and what else their artist was heard under. */
export function albumGroup({ heading: wanted }: { heading: string }): AlbumGroup {
  const artist = LOG.find((play) => same(heading(play), wanted))?.artist;
  if (artist === undefined) {
    return { heading: wanted, artist: "", members: [], others: [] };
  }

  // Each spelling the artist was heard under, biggest first.
  const counts = new Map<string, number>();
  for (const play of LOG) {
    if (play.artist === artist && play.album !== null) {
      counts.set(play.album, (counts.get(play.album) ?? 0) + 1);
    }
  }
  const spellings = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const others = new Map<string, AlbumNeighbour>();
  for (const [album, count] of spellings) {
    const head = FOLDED[album] ?? album;
    if (!same(head, wanted)) {
      const other = others.get(head) ?? { heading: head, plays: 0, albums: [] };
      others.set(head, { ...other, plays: other.plays + count, albums: [...other.albums, album] });
    }
  }
  return {
    heading: wanted,
    artist,
    members: spellings
      .filter(([album]) => same(FOLDED[album] ?? album, wanted))
      .map(([album, count]) => ({ album, plays: count, pinned: false })),
    others: [...others.values()].sort((a, b) => b.plays - a.plays),
  };
}
