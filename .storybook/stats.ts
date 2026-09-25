import { BIN_WIDTH } from "../src/features/stats/histogram";
import type {
  AlbumBitrate,
  GenreBreakdown,
  GenreSlice,
  HistogramBin,
  HistogramField,
  LibraryTotals,
  TagHealth,
  Track,
  TrackQuery,
} from "../src/ipc";
import { GENRE_PARENTS } from "./fixtures";
import { groupArtist, groupsOf, libraryStats, lineage, rows } from "./library";

/**
 * The Library tab's aggregates, over the same rows `library.ts` answers the
 * views with, so a scope or a genre crumb narrows every panel at once and the
 * panels agree with each other and with the library.
 */

export function libraryTotals({ query }: { query: TrackQuery }): LibraryTotals {
  const matched = rows(query);
  const { tracks, durationMs, bytes, missing } = libraryStats({ query });
  return {
    tracks,
    artists: new Set(matched.map(groupArtist)).size,
    albums: groupsOf(matched, (track) => `${track.album}\0${groupArtist(track)}`).length,
    durationMs,
    bytes,
    missing,
  };
}

const FIELDS: Record<HistogramField, (track: Track) => number | null> = {
  bitrate: (track) => track.bitrate,
  sampleRate: (track) => track.sample_rate,
  year: (track) => track.year,
  duration: (track) => track.duration_ms,
};

/** Only the bins that hold something, lowest first, as the `GROUP BY` returns them. */
export function histogram({
  query,
  field,
}: {
  query: TrackQuery;
  field: HistogramField;
}): HistogramBin[] {
  const width = BIN_WIDTH[field];
  const counts = new Map<number, number>();
  for (const track of rows(query)) {
    const value = FIELDS[field](track);
    if (value !== null) {
      const bin = Math.floor(value / width) * width;
      counts.set(bin, (counts.get(bin) ?? 0) + 1);
    }
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => a.value - b.value);
}

export function worstByBitrate({
  query,
  limit,
}: {
  query: TrackQuery;
  limit: number;
}): AlbumBitrate[] {
  return groupsOf(
    rows(query).filter((track) => track.album !== null && track.bitrate !== null),
    (track) => `${track.album}\0${groupArtist(track)}`,
  )
    .map((group): AlbumBitrate => {
      const first = group[0] as Track;
      return {
        album: first.album as string,
        artist: groupArtist(first),
        tracks: group.length,
        meanBitrate: Math.round(
          group.reduce((sum, track) => sum + (track.bitrate as number), 0) / group.length,
        ),
        coverHash: first.cover_hash,
      };
    })
    .sort((a, b) => a.meanBitrate - b.meanBitrate || a.album.localeCompare(b.album))
    .slice(0, limit);
}

/**
 * One level of the tree under `parent`. A track counts toward the child of
 * `parent` on its lineage, or toward `own` when its tag is `parent` itself.
 */
export function genreBreakdown({
  query,
  parent,
}: {
  query: TrackQuery;
  parent: string | null;
}): GenreBreakdown {
  const slices = new Map<string, GenreSlice>();
  let own = 0;
  let untagged = 0;
  for (const track of rows(query)) {
    if (track.genre === null) {
      untagged += parent === null ? 1 : 0;
      continue;
    }
    const chain = lineage(track.genre);
    const at = parent === null ? chain.length : chain.indexOf(parent);
    if (at === 0) {
      own += 1;
    }
    if (at <= 0) {
      continue;
    }
    const label = chain[at - 1] as string;
    const slice = slices.get(label) ?? {
      label,
      tracks: 0,
      parentSource: GENRE_PARENTS[label]?.source ?? "unknown",
      hasChildren: false,
    };
    slices.set(label, {
      ...slice,
      tracks: slice.tracks + 1,
      hasChildren: slice.hasChildren || at > 1,
    });
  }
  return {
    slices: [...slices.values()].sort(
      (a, b) => b.tracks - a.tracks || a.label.localeCompare(b.label),
    ),
    own,
    untagged,
  };
}

export function tagHealth({ query }: { query: TrackQuery }): TagHealth {
  const matched = rows(query);
  const missing = (value: (track: Track) => unknown) =>
    matched.filter((track) => value(track) === null).length;
  return {
    tracks: matched.length,
    title: missing((track) => track.title),
    artist: missing((track) => track.artist),
    album: missing((track) => track.album),
    albumArtist: missing((track) => track.album_artist),
    genre: missing((track) => track.genre),
    year: missing((track) => track.year),
    trackNo: missing((track) => track.track_no),
    cover: missing((track) => track.cover_hash),
  };
}
