import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { LIBRARY, writeLibrary } from "./fixtures";

/**
 * The artwork the fixture library carries, checked without an app.
 *
 * Phase 39's e2e spec asserts that a background appears behind a track with a
 * cover. If the PNG `fixtures.ts` hand-builds is malformed, `lofty` still
 * stores the bytes, the palette extractor still declines them, and the spec
 * fails saying "no background appeared" - which points at the feature rather
 * than at the fixture. Four chunks and a CRC are worth checking here, where a
 * failure names itself.
 *
 * `png` and `apic` are internal to `fixtures.ts`, so this reads the bytes that
 * come out of `writeLibrary` rather than calling them: what matters is what a
 * reader finds in the file, not how it was assembled.
 */

const COVERED = LIBRARY.find((track) => track.cover !== undefined);

/** One fixture file's bytes, written to a directory that does not outlive it. */
function fixtureBytes(file: string): Buffer {
  const root = mkdtempSync(join(tmpdir(), "apex-fixture-"));
  try {
    writeLibrary(root);
    return readFileSync(join(root, ...file.split("/")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The ID3 tag at the front of a fixture's bytes, from its syncsafe length. */
function tag(bytes: Buffer): Buffer {
  const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = [...bytes.subarray(6, 10)];
  return bytes.subarray(10, 10 + ((b0 << 21) | (b1 << 14) | (b2 << 7) | b3));
}

/** The picture payload of the first APIC frame, past its MIME and description. */
function picture(id3: Buffer): Buffer {
  const at = id3.indexOf("APIC", 0, "latin1");
  expect(at, "the tag carries no APIC frame").toBeGreaterThanOrEqual(0);

  const payload = id3.subarray(at + 10, at + 10 + id3.readUInt32BE(at + 4));

  // Encoding byte, then a null-terminated MIME type, the picture type, and a
  // null-terminated description.
  expect(payload[0]).toBe(0x00);
  const mimeEnd = payload.indexOf(0x00, 1);
  expect(payload.subarray(1, mimeEnd).toString("latin1")).toBe("image/png");
  // 3 is "front cover", which is the type a player looks for first.
  expect(payload[mimeEnd + 1]).toBe(0x03);
  expect(payload[mimeEnd + 2]).toBe(0x00);

  return payload.subarray(mimeEnd + 3);
}

interface Chunk {
  type: string;
  payload: Buffer;
  /** The CRC the file states, which is not necessarily the one it should. */
  stated: number;
}

/** Every chunk in a PNG, in order, past the 8-byte signature. */
function chunks(png: Buffer): Chunk[] {
  const found: Chunk[] = [];
  let at = 8;
  while (at + 12 <= png.length) {
    const length = png.readUInt32BE(at);
    found.push({
      type: png.subarray(at + 4, at + 8).toString("latin1"),
      payload: png.subarray(at + 8, at + 8 + length),
      stated: png.readUInt32BE(at + 8 + length),
    });
    at += 12 + length;
  }
  return found;
}

/** CRC-32, the reflected polynomial PNG and zip both use. */
function crc32(bytes: Buffer): number {
  let remainder = 0xffffffff;
  for (const byte of bytes) {
    remainder ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      remainder = remainder & 1 ? (remainder >>> 1) ^ 0xedb88320 : remainder >>> 1;
    }
  }
  return (remainder ^ 0xffffffff) >>> 0;
}

describe("the fixture library's artwork", () => {
  it("gives exactly one album a cover", () => {
    // Both halves matter. Something has to have artwork for a background to
    // appear behind, and something has to have none for its absence to be
    // observable rather than assumed.
    const withCover = LIBRARY.filter((track) => track.cover !== undefined);

    expect(withCover.map((track) => track.album)).toEqual(["Harbour", "Harbour"]);
    expect(LIBRARY.length).toBeGreaterThan(withCover.length);
  });

  it("carries three well-separated colours, so three blobs can be told apart", () => {
    const cover = COVERED?.cover ?? [];

    expect(cover).toHaveLength(3);
    for (const [index, colour] of cover.entries()) {
      for (const other of cover.slice(index + 1)) {
        const distance =
          Math.abs(colour[0] - other[0]) +
          Math.abs(colour[1] - other[1]) +
          Math.abs(colour[2] - other[2]);

        expect(distance, `${colour} and ${other} would photograph as one blob`).toBeGreaterThan(
          150,
        );
      }
    }
  });
});

describe("the PNG it builds by hand", () => {
  const image = picture(tag(fixtureBytes(COVERED?.file ?? "")));
  const parsed = chunks(image);

  it("starts with the PNG signature", () => {
    expect([...image.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("holds the three chunks a PNG needs and nothing else", () => {
    expect(parsed.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("declares its own size and format in IHDR", () => {
    const ihdr = parsed[0]?.payload as Buffer;

    expect(ihdr.readUInt32BE(0)).toBe(COVERED?.cover?.length);
    expect(ihdr.readUInt32BE(4)).toBe(1);
    // 8 bits a channel, truecolour, and the only compression, filter and
    // interlace methods PNG has.
    expect([...ihdr.subarray(8)]).toEqual([8, 2, 0, 0, 0]);
  });

  it("checksums every chunk correctly", () => {
    // A wrong CRC is exactly the failure that would leave the spec blaming the
    // feature: a decoder rejects the image and no palette comes back.
    for (const { type, payload, stated } of parsed) {
      const over = Buffer.concat([Buffer.from(type, "latin1"), payload]);

      expect(crc32(over), `${type} checksum`).toBe(stated);
    }
  });

  it("holds the colours it was given, one scanline, unfiltered", () => {
    const inflated = inflateSync(parsed[1]?.payload as Buffer);

    // A leading zero for "no filter on this row", then three bytes a pixel.
    expect(inflated[0]).toBe(0x00);
    expect([...inflated.subarray(1)]).toEqual((COVERED?.cover ?? []).flat());
  });
});
