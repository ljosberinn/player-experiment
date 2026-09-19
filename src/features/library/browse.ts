import type { BrowseGroup, BrowseKind } from "../../ipc";

/**
 * What an untagged group is called.
 *
 * The database stores absence as NULL rather than a string, so the label lives
 * here: "Unknown Artist" is a value files genuinely carry in their tags, and a
 * group of those has to stay distinguishable from the group with no artist at
 * all.
 */
export function unknownLabel(kind: BrowseKind): string {
  switch (kind) {
    case "albums":
      return "Unknown Release";
    case "artists":
      return "Unknown Artist";
    case "genres":
      return "Unknown Genre";
  }
}

/**
 * What a release credited to more than one artist is called.
 *
 * Lives here for the reason `unknownLabel` does: the row carries how many
 * distinct artists the group holds, and naming them is the frontend's job. A
 * merged compilation must not read as whichever of twelve `min()` picked.
 */
export const MANY_ARTISTS_LABEL = "Various Artists";

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
 *
 * Three states, not two. A release is grouped by its identity rather than by
 * its artist, so it can hold several: no artist at all and many artists are
 * different things, and `secondary` is one arbitrary member of the group in the
 * second case.
 */
export function groupSubtitle(group: BrowseGroup, kind: BrowseKind): string | null {
  if (kind !== "albums") {
    return null;
  }
  if (group.artistCount > 1) {
    return MANY_ARTISTS_LABEL;
  }
  return group.secondary ?? unknownLabel("artists");
}

/**
 * The separator between the two tags of a release carrying no MusicBrainz id.
 *
 * U+001F, the ASCII unit separator, rather than a space: with a space, album
 * "A" by "B C" and album "A B" by "C" would produce the same identity. A
 * control character cannot appear in a tag string read from a file.
 *
 * `release_identity` in `db/query.rs` is the other half of this and the two
 * have to agree, because `albumIdentity` builds ids the drill-in compares
 * against the ones that query produced.
 */
const UNIT_SEPARATOR = "\u001f";

/**
 * A release's identity from its own tags, for a track the grid did not supply.
 *
 * An empty string rather than null on either side, because the query folds an
 * absent tag the same way - see `release_identity`.
 */
export function albumIdentity(album: string | null, artist: string | null): string {
  return `${album ?? ""}${UNIT_SEPARATOR}${artist ?? ""}`;
}

/**
 * A stable identity for a group, for React keys.
 *
 * The row carries it now, and this is left only to survive `id` being null -
 * which the untagged artist and genre groups are, and a React key may not be.
 */
export function groupId(group: BrowseGroup): string {
  return group.id ?? "";
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
