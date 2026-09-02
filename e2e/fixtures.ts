import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

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

/**
 * A PNG of `colours`, one pixel per column, built by hand.
 *
 * Hand-built for the same reason the mp3s are: no encoder dependency, no
 * binary in git, no licence question. A PNG is four chunks and a CRC, which is
 * less code than pulling in a library to write four chunks and a CRC.
 *
 * It exists so that phase 39 has something real to look at. The palette
 * extractor decodes whatever `lofty` hands it, so a fixture whose artwork is
 * the string "not an image" - which is what the file beside these tracks is -
 * proves only the failure path.
 */
export function png(colours: ReadonlyArray<readonly [number, number, number]>): Buffer {
  // One scanline: the mandatory filter byte, then three bytes a pixel.
  const raw = Buffer.concat([Buffer.from([0x00]), Buffer.from(colours.flat())]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(colours.length, 0);
  ihdr.writeUInt32BE(1, 4);
  // 8 bits a channel, colour type 2 (truecolour), the only compression,
  // filter and interlace methods PNG defines.
  ihdr.set([8, 2, 0, 0, 0], 8);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** One PNG chunk: length, type, payload, CRC over type and payload. */
function chunk(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length, 0);
  head.write(type, 4, "latin1");

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), payload])), 0);

  return Buffer.concat([head, payload, crc]);
}

/** CRC-32, the reflected polynomial PNG and zip both use. */
function crc32(bytes: Buffer): number {
  let remainder = 0xffffffff;
  for (const byte of bytes) {
    remainder ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      // The polynomial, reflected: 0xedb88320. Computed rather than tabulated -
      // the largest input here is a few dozen bytes.
      remainder = remainder & 1 ? (remainder >>> 1) ^ 0xedb88320 : remainder >>> 1;
    }
  }
  return (remainder ^ 0xffffffff) >>> 0;
}

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
    ...(meta.cover === undefined ? [] : [apic(png(meta.cover))]),
  ]);

  const header = Buffer.concat([
    Buffer.from("ID3", "latin1"),
    Buffer.from([0x03, 0x00, 0x00]),
    syncsafe(frames.length),
  ]);

  return Buffer.concat([header, frames]);
}

/** An ID3v2.3 attached picture: a front cover, with no description. */
function apic(image: Buffer): Buffer {
  const payload = Buffer.concat([
    // Latin-1 text encoding, then the MIME type and an empty description, each
    // terminated the way v2.3 wants them, with the picture type between.
    Buffer.from([0x00]),
    Buffer.from("image/png\u0000", "latin1"),
    Buffer.from([0x03]),
    Buffer.from([0x00]),
    image,
  ]);

  const header = Buffer.alloc(10);
  header.write("APIC", 0, "latin1");
  header.writeUInt32BE(payload.length, 4);

  return Buffer.concat([header, payload]);
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
  /**
   * Embedded artwork, as the colours of a one-pixel-tall PNG. Absent for most
   * of the library on purpose: the background that follows the music has to be
   * seen both arriving and going away, and a library where every album has a
   * cover can only show the first half.
   */
  cover?: ReadonlyArray<readonly [number, number, number]>;
}

/**
 * The artwork on *Harbour*, and the only artwork in the fixture library.
 *
 * Three colours far enough apart that the three blobs they become are
 * distinguishable from each other in a screenshot at a tenth of opacity - a
 * palette of three near-identical blues would photograph as one wash and prove
 * nothing about the extraction.
 */
const HARBOUR_COVER = [
  [196, 64, 32],
  [32, 96, 176],
  [224, 208, 160],
] as const;

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
 *
 * One album carries embedded artwork and two do not, which is what lets phase
 * 39's background be seen both arriving and going away.
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
    cover: HARBOUR_COVER,
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
    cover: HARBOUR_COVER,
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
