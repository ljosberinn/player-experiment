import type { MenuItem } from "../src/components/ui/ContextMenu";
import { rowMenuItems } from "../src/features/library/rowMenu";
import { exportSelectionLabel, type Menu, menus } from "../src/features/shell/menus";
import type {
  BrowseGroup,
  CrashReport,
  Playlist,
  ReleaseCandidate,
  ReleaseDetail,
  ReleaseGroup,
  ReviewEntry,
  Track,
} from "../src/ipc";

/** A square cover as an inline SVG, so the fixtures carry no binary assets. */
function cover(hue: number, mark: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" fill="hsl(${hue} 42% 36%)"/>` +
    `<circle cx="72" cy="30" r="22" fill="hsl(${hue} 55% 62%)"/>` +
    `<text x="10" y="90" font-family="sans-serif" font-size="28" font-weight="700" fill="white">${mark}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The image the tag editor has staged: striped, so it cannot pass for any of `COVERS`. */
export const STAGED_COVER = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<defs><pattern id="s" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="10" height="20" fill="hsl(40 90% 55%)"/></pattern></defs>` +
    `<rect width="100" height="100" fill="hsl(0 0% 12%)"/>` +
    `<rect width="100" height="100" fill="url(#s)"/>` +
    `</svg>`,
)}`;

interface Album {
  album: string;
  artist: string;
  year: number;
  genre: string;
  cover: string | null;
  titles: string[];
}

const ALBUMS: Album[] = [
  {
    album: "Harbour Lights",
    artist: "The Lanterns",
    year: 2019,
    genre: "Indie Rock",
    cover: "a1",
    titles: [
      "Low Tide",
      "Signal Fires",
      "Breakwater",
      "Saltwater Heart",
      "Moorings",
      "Undertow",
      "Lighthouse Keeper",
    ],
  },
  {
    album: "Night Transit",
    artist: "Mira Kohl",
    year: 2021,
    genre: "Electronic",
    cover: "b2",
    titles: ["Departures", "Sodium", "Last Train Home", "Overpass", "Neon Static", "Terminus"],
  },
  {
    album: "Field Recordings, Vol. 2",
    artist: "Orchard Ensemble",
    year: 2015,
    genre: "Folk",
    cover: "c3",
    titles: [
      "Morning in the Orchard, Before Anyone Else Had Woken and the Frost Was Still on the Grass",
      "Pollen",
      "Hedgerow",
      "Gathering",
      "Windbreak",
      "Evensong",
      "Fallow",
    ],
  },
  {
    album: "Copper",
    artist: "Dana Reyes",
    year: 2023,
    genre: "Jazz",
    cover: "d4",
    titles: ["Patina", "Blue Verdigris", "Conductor", "Alloy", "Wire", "Solder"],
  },
  {
    album: "Demos 2008",
    artist: "The Lanterns",
    year: 2008,
    genre: "Punk",
    cover: null,
    titles: [
      "Untitled 1",
      "Garage",
      "Feedback Loop",
      "Three Chords",
      "Basement Show",
      "Untitled 2",
      "Encore",
    ],
  },
  {
    album: "Glass Garden",
    artist: "Sol & The Weather",
    year: 2017,
    genre: "Dream Pop",
    cover: "f6",
    titles: [
      "Greenhouse",
      "Condensation",
      "Orchid",
      "Paper Lanterns",
      "Glasshouse Rain",
      "Bloom",
      "Stems",
    ],
  },
];

const HUES: Record<string, number> = { a1: 205, b2: 280, c3: 95, d4: 22, f6: 330 };

/** One cover per album that has one, keyed on the hash `Track.cover_hash` carries. */
export const COVERS: Record<string, string> = Object.fromEntries(
  Object.entries(HUES).map(([hash, hue]) => [hash, cover(hue, hash.toUpperCase())]),
);

/** Midday on 2026-03-01, so a date drawn from a fixture reads the same every run. */
const EPOCH = 1_772_366_400;

export function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    path: "C:\\Music\\track.mp3",
    duration_ms: 214_000,
    title: "Track",
    artist: "Artist",
    album: "Album",
    album_artist: null,
    genre: null,
    year: null,
    track_no: null,
    disc_no: null,
    comment: null,
    bitrate: 320,
    sample_rate: 44_100,
    cover_hash: null,
    added_at: EPOCH,
    play_count: 0,
    last_played_at: null,
    missing_since: null,
    release_group_mbid: null,
    ...overrides,
  };
}

/**
 * The library the stories draw from: 40 tracks over 6 albums, with one album
 * uncovered, one title long enough to truncate and one file gone missing. The
 * Lanterns have two of the albums, so an artist opens on more than one release.
 */
export const LIBRARY: Track[] = ALBUMS.flatMap((album, a) =>
  album.titles.map((title, t) => {
    const id = a * 100 + t + 1;
    return track({
      id,
      path: `C:\\Music\\${album.artist}\\${album.album}\\${String(t + 1).padStart(2, "0")} ${title}.mp3`,
      duration_ms: 150_000 + ((id * 37_000) % 180_000),
      title,
      artist: album.artist,
      album: album.album,
      album_artist: album.artist,
      genre: album.genre,
      year: album.year,
      track_no: t + 1,
      disc_no: 1,
      cover_hash: album.cover,
      added_at: EPOCH - a * 86_400 * 30,
      play_count: (id * 7) % 23,
      last_played_at: (id * 7) % 23 === 0 ? null : EPOCH - id * 3_600,
      missing_since: id === 204 ? EPOCH - 86_400 : null,
    });
  }),
);

export function playlist(id: number, name: string, trackCount: number): Playlist {
  return { id, name, kind: "static", trackCount, createdAt: EPOCH, builtIn: null };
}

export function smartPlaylist(
  id: number,
  name: string,
  trackCount: number,
  builtIn: Playlist["builtIn"] = null,
): Playlist {
  return { id, name, kind: "smart", trackCount, createdAt: EPOCH, builtIn };
}

export function browseGroup(overrides: Partial<BrowseGroup> = {}): BrowseGroup {
  return {
    id: "Album",
    key: "Album",
    secondary: null,
    artistCount: 1,
    trackCount: 1,
    durationMs: 214_000,
    coverHash: null,
    year: null,
    ...overrides,
  };
}

export function releaseGroup(overrides: Partial<ReleaseGroup> = {}): ReleaseGroup {
  return {
    id: "Album",
    title: "Album",
    artist: null,
    year: null,
    coverHash: null,
    trackCount: 1,
    durationMs: 214_000,
    format: "MP3",
    bitrate: 320,
    ...overrides,
  };
}

export const CRASH: CrashReport = {
  when: EPOCH,
  summary: "called `Option::unwrap()` on a `None` value at src\\player\\decode.rs:212:41",
  details: [
    "thread 'player' panicked at src\\player\\decode.rs:212:41:",
    "called `Option::unwrap()` on a `None` value",
    "stack backtrace:",
    "   0: std::panicking::begin_panic_handler",
    "   1: core::panicking::panic_fmt",
    "   2: core::panicking::panic",
    "   3: core::option::unwrap_failed",
    "   4: apex_lib::player::decode::Decoder::next_packet",
    "   5: apex_lib::player::engine::Engine::fill",
    "   6: std::sys::backtrace::__rust_begin_short_backtrace",
  ].join("\n"),
  path: "C:\\Users\\me\\AppData\\Roaming\\dev.ljosberinn.apex\\crashes.log",
};

/** What Late Night holds, in its own order. */
export const LATE_NIGHT: number[] = [103, 502, 305, 104, 501, 203, 106, 504, 306, 205];

/** Two static playlists for the Add to Playlist submenu, and a smart one it leaves out. */
export const PLAYLISTS: Playlist[] = [
  playlist(1, "Late Night", LATE_NIGHT.length),
  playlist(2, "Road Trip", 118),
  smartPlaylist(3, "Unplayed Jazz", 12),
];

/** The smart playlists every library ships with, which `LibraryNav` draws. */
export const BUILT_INS: Playlist[] = [
  smartPlaylist(90, "Favorites", 0, "favorites"),
  smartPlaylist(
    91,
    "Most Played",
    LIBRARY.filter((entry) => entry.play_count > 0).length,
    "mostPlayed",
  ),
  smartPlaylist(92, "Recently Added", LIBRARY.length, "recentlyAdded"),
];

const noop = () => {};

/** The right-click menu on one row of `LIBRARY`, as `SongTable` builds it. */
export function rowItems(overrides: Partial<Parameters<typeof rowMenuItems>[0]> = {}): MenuItem[] {
  return rowMenuItems({
    count: 1,
    playlists: PLAYLISTS,
    openPlaylist: null,
    track: LIBRARY[0] ?? null,
    onPlay: noop,
    onEdit: noop,
    onLookup: noop,
    onAddTo: noop,
    onRemove: noop,
    onRemoveFromLibrary: noop,
    loving: { loved: false, keyed: true, onToggle: noop },
    onExport: noop,
    onReveal: noop,
    onOpenUrl: noop,
    ...overrides,
  });
}

/**
 * The menu bar with two songs selected, three files missing and last.fm
 * connected, so every menu has something in it.
 */
export const MENUS: Menu[] = menus({
  selectionCount: 2,
  missingCount: 3,
  removedCount: 1,
  hasExportTarget: true,
  exportSelectionLabel: exportSelectionLabel(2, null),
  lastfmConfigured: true,
  lastfmUsername: "orchard_ears",
  // `AppMenus` leaves removal to File's own entry.
  rowItems: rowItems({ count: 2, track: null, onRemoveFromLibrary: undefined }),
  onAddFolder: noop,
  onRescan: noop,
  onRemoveFromLibrary: noop,
  onRemoveMissing: noop,
  onForgetRemoved: noop,
  onSettings: noop,
  onExportAll: noop,
  onExportSelection: noop,
  onLastfmDisconnect: noop,
  onOpenRepository: noop,
});

/** A MusicBrainz result, as the search lists it before its tracklist is fetched. */
export function candidate(overrides: Partial<ReleaseCandidate> = {}): ReleaseCandidate {
  return {
    mbid: "00000000-0000-0000-0000-000000000000",
    releaseGroupMbid: null,
    title: "Album",
    artist: "Artist",
    date: null,
    country: null,
    format: null,
    trackCount: 1,
    discCount: 1,
    score: 1,
    ...overrides,
  };
}

/** Harbour Lights' files, in track order. */
export const HARBOUR_LIGHTS: Track[] = LIBRARY.filter((entry) => entry.album === "Harbour Lights");

/**
 * Three pressings of Harbour Lights. The first has a bonus track the files
 * lack, so its track count disagrees with them.
 */
export const CANDIDATES: ReleaseCandidate[] = [
  candidate({
    mbid: "5b0e7c1a-3f6d-4c2e-9a41-1d2c3e4f5a01",
    title: "Harbour Lights",
    artist: "The Lanterns",
    date: "2019-05-17",
    country: "GB",
    format: "CD",
    trackCount: 8,
    score: 0.94,
  }),
  candidate({
    mbid: "5b0e7c1a-3f6d-4c2e-9a41-1d2c3e4f5a02",
    title: "Harbour Lights",
    artist: "The Lanterns",
    date: "2019",
    country: "XW",
    format: "Digital Media",
    trackCount: 7,
    score: 0.88,
  }),
  candidate({
    mbid: "5b0e7c1a-3f6d-4c2e-9a41-1d2c3e4f5a03",
    title: "Harbour Lights (Deluxe Edition)",
    artist: "The Lanterns",
    date: "2020-11-06",
    country: "US",
    format: "CD",
    trackCount: 7,
    discCount: 2,
    score: 0.71,
  }),
];

/**
 * The first pressing's tracklist. Against `HARBOUR_LIGHTS` it retitles one
 * track, credits a guest on another and renumbers the three after its bonus
 * track, so the mapping has rows that change and three that fold away.
 */
export const HARBOUR_LIGHTS_DETAIL: ReleaseDetail = {
  candidate: CANDIDATES[0] as ReleaseCandidate,
  albumArtist: "The Lanterns",
  year: 2019,
  genre: "Indie Rock",
  releaseType: "Album",
  tracks: [
    "Low Tide",
    "Signal Fires",
    "Breakwater (Live at the Pier)",
    "Saltwater Heart",
    "Harbour Lights",
    "Moorings",
    "Undertow",
    "Lighthouse Keeper",
  ].map((title, at) => ({
    title,
    artist: title === "Undertow" ? "The Lanterns feat. Mira Kohl" : "The Lanterns",
    trackNo: at + 1,
    discNo: 1,
    durationMs:
      HARBOUR_LIGHTS.find((file) => title.startsWith(file.title ?? ""))?.duration_ms ?? 201_000,
  })),
  coverPath: "C:\\Users\\me\\AppData\\Local\\dev.ljosberinn.apex\\staged-cover.jpg",
};

/** Each album of `LIBRARY` as the release a lookup would open on. */
function release(album: string, score: number | null, candidates: ReleaseCandidate[] | null) {
  const files = LIBRARY.filter((entry) => entry.album === album);
  return {
    album,
    artist: files[0]?.album_artist ?? null,
    trackIds: files.map((file) => file.id),
    score,
    candidates,
  } satisfies ReviewEntry;
}

/** Two releases picked out of the library, which arrive unsearched. */
export const SELECTION: ReviewEntry[] = [
  release("Harbour Lights", null, null),
  release("Demos 2008", null, null),
];

/**
 * What the unattended pass left for review, best score first. Harbour Lights'
 * score was measured on the pressing with the bonus track, so it reads as
 * disagreeing.
 */
export const REVIEW_QUEUE: ReviewEntry[] = [
  release("Harbour Lights", 0.97, CANDIDATES),
  release("Night Transit", 0.86, [
    candidate({ title: "Night Transit", artist: "Mira Kohl", trackCount: 6, score: 0.86 }),
  ]),
  release("Glass Garden", 0.74, [
    candidate({ title: "Glass Garden", artist: "Sol & The Weather", trackCount: 7, score: 0.74 }),
  ]),
  release("Field Recordings, Vol. 2", 0.52, []),
  release("Demos 2008", null, null),
];

/** Labels from the genre tree, which `GenreCombobox` offers. */
export const GENRES: string[] = [
  "Ambient",
  "Art Pop",
  "Chamber Folk",
  "Dream Pop",
  "Electronic",
  "Folk",
  "Folk Rock",
  "Indie Folk",
  "Indie Pop",
  "Indie Rock",
  "Jazz",
  "Jazz Fusion",
  "Post-Punk",
  "Punk",
  "Shoegaze",
];
