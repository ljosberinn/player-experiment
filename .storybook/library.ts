import { albumIdentity } from "../src/features/library/browse";
import { useLovedStore } from "../src/features/love/store";
import type {
  BrowseGroup,
  BrowseKind,
  LibraryStats,
  ReleaseGroup,
  SortField,
  Track,
  TrackQuery,
} from "../src/ipc";
import { GENRE_PARENTS, LATE_NIGHT, LIBRARY } from "./fixtures";

/**
 * The library queries answered over `LIBRARY`, so a story can navigate through
 * the store's own actions instead of seeding the state they derive.
 *
 * Only as faithful as the views need: a search is a substring, relevance is
 * the natural order, a playlist holds what `members` says, and a genre is a
 * branch of `GENRE_PARENTS`. What must match
 * `db/query.rs` exactly is the drill-in order, because `ReleaseGroups` cuts the
 * rows into releases by a prefix sum over `release_groups`.
 */

/** A playlist's rows in its own order, or null for a playlist this library does not fill. */
function members(playlistId: number): Track[] | null {
  switch (playlistId) {
    case 1:
      return LATE_NIGHT.map((id) => LIBRARY.find((entry) => entry.id === id) as Track);
    case 90:
      return LIBRARY.filter((entry) => useLovedStore.getState().loved.has(entry.id));
    case 91:
      return LIBRARY.filter((entry) => entry.play_count > 0);
    case 92:
      return LIBRARY;
    default:
      return null;
  }
}

export function groupArtist(track: Track): string | null {
  return track.album_artist ?? track.artist;
}

function releaseOf(track: Track): string {
  return track.release_group_mbid ?? albumIdentity(track.album, groupArtist(track));
}

function identity(track: Track, kind: BrowseKind): string | null {
  switch (kind) {
    case "albums":
      return releaseOf(track);
    case "artists":
      return groupArtist(track);
    case "genres":
      return track.genre;
  }
}

function label(track: Track, kind: BrowseKind): string | null {
  switch (kind) {
    case "albums":
      return track.album;
    case "artists":
      return groupArtist(track);
    case "genres":
      return track.genre;
  }
}

/** `genre` and every label above it, leaf first. */
export function lineage(genre: string): string[] {
  const chain = [genre];
  for (let link = GENRE_PARENTS[genre]; link !== undefined; link = GENRE_PARENTS[link.parent]) {
    chain.push(link.parent);
  }
  return chain;
}

const FIELDS: Partial<Record<SortField, keyof Track>> = {
  title: "title",
  artist: "artist",
  album: "album",
  albumArtist: "album_artist",
  genre: "genre",
  year: "year",
  trackNo: "track_no",
  durationMs: "duration_ms",
  bitrate: "bitrate",
  addedAt: "added_at",
  playCount: "play_count",
  lastPlayedAt: "last_played_at",
  path: "path",
};

/** Nulls last in either direction, as the backend orders them. */
function compare(a: unknown, b: unknown): number {
  if (a === b) {
    return 0;
  }
  if (a === null || a === undefined) {
    return 1;
  }
  if (b === null || b === undefined) {
    return -1;
  }
  return typeof a === "string"
    ? a.localeCompare(String(b), undefined, { sensitivity: "base" })
    : Number(a) - Number(b);
}

/** Every row of `query`, filtered and in view order, before paging. */
export function rows(query: TrackQuery): Track[] {
  const source = query.playlistId === null ? LIBRARY : (members(query.playlistId) ?? []);
  const term = query.search?.trim().toLowerCase() ?? "";
  const { browse } = query;
  const matched = source.filter(
    (track) =>
      (term === "" ||
        [track.title, track.artist, track.album, track.genre].some((value) =>
          value?.toLowerCase().includes(term),
        )) &&
      (browse === null || identity(track, browse.kind) === browse.id) &&
      (query.genre === null ||
        (track.genre !== null && lineage(track.genre).includes(query.genre))),
  );

  // Position and relevance have no column: the source's own order is the sort.
  const field = FIELDS[query.sortBy];
  const sign = query.direction === "desc" ? -1 : 1;
  const order = new Map(source.map((track, index) => [track.id, index]));
  const releases = browse === null ? null : releaseOrder(matched);
  return [...matched].sort(
    (a, b) =>
      (releases === null
        ? 0
        : (releases.get(releaseOf(a)) as number) - (releases.get(releaseOf(b)) as number)) ||
      (field === undefined
        ? sign * ((order.get(a.id) as number) - (order.get(b.id) as number))
        : sign * compare(a[field], b[field]) ||
          compare(a.album, b.album) ||
          compare(a.track_no, b.track_no)),
  );
}

/** Each release's place in a drill-in: `RELEASE_GROUP_ORDER`, oldest first. */
function releaseOrder(tracks: Track[]): Map<string, number> {
  const first = new Map<string, Track>();
  for (const track of tracks) {
    const id = releaseOf(track);
    const seen = first.get(id);
    if (seen === undefined || compare(track.year, seen.year) < 0) {
      first.set(id, track);
    }
  }
  const sorted = [...first].sort(
    ([idA, a], [idB, b]) =>
      compare(a.year, b.year) || compare(a.album, b.album) || compare(idA, idB),
  );
  return new Map(sorted.map(([id], index) => [id, index]));
}

export function groupsOf(tracks: Track[], key: (track: Track) => string | null): Track[][] {
  const groups = new Map<string | null, Track[]>();
  for (const track of tracks) {
    const id = key(track);
    groups.set(id, [...(groups.get(id) ?? []), track]);
  }
  return [...groups.values()];
}

function min<T>(values: T[]): T | null {
  return values.reduce<T | null>(
    (least, value) => (least === null || compare(value, least) < 0 ? value : least),
    null,
  );
}

export function durationOf(tracks: Track[]): number {
  return tracks.reduce((sum, track) => sum + (track.duration_ms ?? 0), 0);
}

export function queryTracks({ query }: { query: TrackQuery }): Track[] {
  return rows(query).slice(query.offset, query.offset + query.limit);
}

export function allTrackIds({ query }: { query: TrackQuery }): number[] {
  return rows(query).map((track) => track.id);
}

export function libraryStats({ query }: { query: TrackQuery }): LibraryStats {
  const matched = rows(query);
  return {
    tracks: matched.length,
    durationMs: durationOf(matched),
    bytes: matched.reduce(
      (sum, track) => sum + ((track.duration_ms ?? 0) * (track.bitrate ?? 0)) / 8,
      0,
    ),
    missing: matched.filter((track) => track.missing_since !== null).length,
    removed: 0,
  };
}

export function browseGroups({ query, kind }: { query: TrackQuery; kind: BrowseKind }) {
  return groupsOf(rows({ ...query, browse: null }), (track) => identity(track, kind))
    .map(
      (group): BrowseGroup => ({
        id: identity(group[0] as Track, kind),
        key: min(group.map((track) => label(track, kind))),
        secondary: kind === "albums" ? min(group.map(groupArtist)) : null,
        artistCount:
          kind === "albums"
            ? new Set(group.map((track) => groupArtist(track)?.toLowerCase())).size
            : 0,
        trackCount: group.length,
        durationMs: durationOf(group),
        coverHash: min(group.map((track) => track.cover_hash)),
        year: min(group.map((track) => track.year)),
      }),
    )
    .sort(
      (a, b) => compare(a.key, b.key) || compare(a.secondary, b.secondary) || compare(a.id, b.id),
    );
}

export function releaseGroups({ query }: { query: TrackQuery }): ReleaseGroup[] {
  const matched = rows(query);
  const order = releaseOrder(matched);
  return groupsOf(matched, releaseOf)
    .map(
      (group): ReleaseGroup => ({
        id: releaseOf(group[0] as Track),
        title: min(group.map((track) => track.album)),
        artist: min(group.map(groupArtist)),
        year: min(group.map((track) => track.year)),
        coverHash: min(group.map((track) => track.cover_hash)),
        trackCount: group.length,
        durationMs: durationOf(group),
        format: "MP3",
        bitrate: Math.round(
          group.reduce((sum, track) => sum + (track.bitrate ?? 0), 0) / group.length,
        ),
      }),
    )
    .sort((a, b) => (order.get(a.id) as number) - (order.get(b.id) as number));
}
