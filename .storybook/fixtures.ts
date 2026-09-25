import type { BrowseGroup, CrashReport, Playlist, ReleaseGroup, Track } from "../src/ipc";

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
    artist: "Unfinished Business",
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
 * uncovered, one title long enough to truncate and one file gone missing.
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
