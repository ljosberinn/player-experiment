import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * A small library of real, playable mp3 files, built at test time.
 *
 * Generated rather than committed, for the same reasons the Rust integration
 * tests generate theirs (`src-tauri/tests/fixture/mod.rs`): no encoder
 * dependency, no binary blobs in git, and no question about the licensing of
 * the audio. Written from Node rather than reusing that Rust helper because
 * this runs before the app is launched, and shelling out to cargo to lay down
 * six files would cost a compile on a runner that has already done one.
 *
 * What the app then does with these files is entirely real: the scanner walks
 * them, `lofty` reads these tags, and the rows under test are whatever came
 * back out of SQLite.
 */

/** One frame of silent MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono. */
function silentFrame(): Buffer {
  // `FF FB` sync + MPEG-1 + Layer III + no CRC, `90` for the 128 kbps/44.1 kHz
  // pair with no padding, `C0` for mono. At that rate a frame is
  // 144 * 128000 / 44100 = 417 bytes, so the rest is silence.
  const frame = Buffer.alloc(417);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0xc0;
  return frame;
}

/** `frames` copies of it, which is the whole audio payload of a fixture. */
function silentAudio(frames: number): Buffer {
  return Buffer.concat(Array.from({ length: frames }, silentFrame));
}

/**
 * A 28-bit size, seven bits per byte.
 *
 * The ID3v2 header length is stored this way so that no byte of it can look
 * like an mp3 sync word to a decoder that seeks into the middle of a file.
 */
function syncsafe(size: number): Buffer {
  return Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
}

/** One ID3v2.3 text frame: `latin1` payload behind its encoding byte. */
function textFrame(id: string, value: string): Buffer {
  const payload = Buffer.concat([Buffer.from([0x00]), Buffer.from(value, "latin1")]);
  const header = Buffer.alloc(10);
  header.write(id, 0, "latin1");
  // v2.3 sizes are plain big-endian; only the header above is syncsafe.
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

/**
 * An ID3v2.3 tag.
 *
 * v2.3 rather than the v2.4 `lofty` writes, because v2.3 needs no
 * unsynchronisation handling and both the scanner and every other reader
 * accept it. Years go in `TYER`, which is where a v2.3 reader looks.
 */
function id3(meta: TrackFixture): Buffer {
  const frames = Buffer.concat([
    textFrame("TIT2", meta.title),
    textFrame("TPE1", meta.artist),
    textFrame("TALB", meta.album),
    textFrame("TPE2", meta.albumArtist),
    textFrame("TCON", meta.genre),
    textFrame("TYER", String(meta.year)),
    textFrame("TRCK", String(meta.trackNo)),
  ]);

  const header = Buffer.concat([
    Buffer.from("ID3", "latin1"),
    Buffer.from([0x03, 0x00, 0x00]),
    syncsafe(frames.length),
  ]);

  return Buffer.concat([header, frames]);
}

export interface TrackFixture {
  /** Relative to the library root, with forward slashes. */
  file: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  year: number;
  trackNo: number;
  /** Frames of silence. One frame is 1152 samples at 44.1 kHz, ~26 ms. */
  frames: number;
  /** What the Time column should read once the scanner has measured it. */
  time: string;
}

/**
 * Six tracks, three albums, three artists.
 *
 * Chosen so that sorting is actually observable: alphabetical by title
 * interleaves the albums (Anchor, Beacon, Drift, Ember, Fathom, Glass), while
 * alphabetical by artist groups them the other way round (Alto Field, Blue
 * Room, Cascade). A sort assertion that held under both orders would prove
 * nothing.
 *
 * Durations are all different, so the Time column cannot pass by coincidence.
 */
export const LIBRARY: TrackFixture[] = [
  {
    file: "Blue Room/Harbour/01 Anchor.mp3",
    title: "Anchor",
    artist: "Blue Room",
    album: "Harbour",
    albumArtist: "Blue Room",
    genre: "Ambient",
    year: 2018,
    trackNo: 1,
    frames: 44,
    time: "0:01",
  },
  {
    file: "Blue Room/Harbour/02 Beacon.mp3",
    title: "Beacon",
    artist: "Blue Room",
    album: "Harbour",
    albumArtist: "Blue Room",
    genre: "Ambient",
    year: 2018,
    trackNo: 2,
    frames: 82,
    time: "0:02",
  },
  {
    file: "Cascade/Terrace/01 Drift.mp3",
    title: "Drift",
    artist: "Cascade",
    album: "Terrace",
    albumArtist: "Cascade",
    genre: "Downtempo",
    year: 2021,
    trackNo: 1,
    frames: 121,
    time: "0:03",
  },
  {
    file: "Cascade/Terrace/02 Ember.mp3",
    title: "Ember",
    artist: "Cascade",
    album: "Terrace",
    albumArtist: "Cascade",
    genre: "Downtempo",
    year: 2021,
    trackNo: 2,
    frames: 159,
    time: "0:04",
  },
  {
    file: "Alto Field/Quiet Hours/01 Fathom.mp3",
    title: "Fathom",
    artist: "Alto Field",
    album: "Quiet Hours",
    albumArtist: "Alto Field",
    genre: "Modern Classical",
    year: 2014,
    trackNo: 1,
    frames: 198,
    time: "0:05",
  },
  {
    file: "Alto Field/Quiet Hours/02 Glass.mp3",
    title: "Glass",
    artist: "Alto Field",
    album: "Quiet Hours",
    albumArtist: "Alto Field",
    genre: "Modern Classical",
    year: 2014,
    trackNo: 2,
    frames: 236,
    time: "0:06",
  },
];

/**
 * Writes [`LIBRARY`] under `root`, replacing whatever was there.
 *
 * Replaced rather than merged: a leftover file from an earlier run would be a
 * seventh track the assertions do not know about, and the failure would name
 * the count rather than the cause.
 */
export function writeLibrary(root: string): TrackFixture[] {
  rmSync(root, { recursive: true, force: true });

  for (const track of LIBRARY) {
    const path = join(root, ...track.file.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.concat([id3(track), silentAudio(track.frames)]));
  }

  // Two files the scanner must ignore. Without them "six rows" would also be
  // satisfied by a scanner that ingests everything it walks past.
  mkdirSync(join(root, "Blue Room", "Harbour"), { recursive: true });
  writeFileSync(join(root, "Blue Room", "Harbour", "cover.jpg"), Buffer.from("not an image"));
  writeFileSync(join(root, "Blue Room", "Harbour", "notes.txt"), "not audio either");

  return LIBRARY;
}
