import type { BrowseGroup, BrowseKind } from "../../ipc";

/**
 * What an untagged group is called.
 *
 * The database stores absence as NULL rather than a string, so the label lives
 * here: "Unknown Album" in the data would collide with an album genuinely
 * named that, and the two must stay distinguishable.
 */
export function unknownLabel(kind: BrowseKind): string {
  switch (kind) {
    case "albums":
      return "Unknown Album";
    case "artists":
      return "Unknown Artist";
    case "genres":
      return "Unknown Genre";
  }
}

/** The heading for a group, falling back to the untagged label. */
export function groupTitle(group: BrowseGroup, kind: BrowseKind): string {
  return group.key ?? unknownLabel(kind);
}

/**
 * The line under an album's title.
 *
 * Only albums have one - an artist's subtitle would repeat its own name - and
 * an album whose artist tags are all empty gets the unknown-artist label
 * rather than a blank line that looks like a rendering bug.
 */
export function groupSubtitle(group: BrowseGroup, kind: BrowseKind): string | null {
  if (kind !== "albums") {
    return null;
  }
  return group.secondary ?? unknownLabel("artists");
}

/**
 * A stable identity for a group, for React keys.
 *
 * Two keys, because albums are grouped by title *and* artist: keying on the
 * title alone would collide for two artists with an eponymous album, and React
 * would reuse one tile for the other.
 *
 * The separator is U+001F, the ASCII unit separator, rather than a space: with
 * a space, album "A" by "B C" and album "A B" by "C" produce the same id. A
 * control character cannot appear in a tag string read from a file.
 */
const UNIT_SEPARATOR = "\u001f";

export function groupId(group: BrowseGroup): string {
  return `${group.key ?? ""}${UNIT_SEPARATOR}${group.secondary ?? ""}`;
}

/**
 * "12 songs", and the year when there is one.
 *
 * Zero is not one: `parse_year` used to accept any four-digit run, so a `0000`
 * date tag is stored as a real year, and rows scanned before it was fixed keep
 * theirs until somebody rescans.
 */
export function groupMeta(group: BrowseGroup): string {
  const songs = `${group.trackCount} ${group.trackCount === 1 ? "song" : "songs"}`;
  return group.year === null || group.year === 0 ? songs : `${group.year} · ${songs}`;
}
