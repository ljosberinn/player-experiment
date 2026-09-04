import type {
  CoverEdit,
  ReleaseDetail,
  ReleaseIdentity,
  RemoteTrack,
  Track,
  TrackEdit,
} from "../../ipc";

/**
 * Which of a release's fields an apply writes.
 *
 * Every one is a checkbox, because a lookup is a suggestion: a release whose
 * tracklist is right and whose artwork is a different pressing's is the
 * ordinary case, and there is no way to know which half a person wants from
 * this side.
 *
 * The two MusicBrainz identifiers are deliberately not here. They say which
 * release the file belongs to rather than what it should be called, they are
 * what makes a second lookup idempotent, and they are written to the whole
 * release rather than the selection - so they are what applying *is*, not
 * something to opt into.
 */
export type FieldId =
  | "title"
  | "artist"
  | "album"
  | "albumArtist"
  | "year"
  | "trackNo"
  | "discNo"
  | "artwork";

export const LOOKUP_FIELDS: { id: FieldId; label: string }[] = [
  { id: "title", label: "Title" },
  { id: "artist", label: "Artist" },
  { id: "album", label: "Album" },
  { id: "albumArtist", label: "Album Artist" },
  { id: "year", label: "Year" },
  { id: "trackNo", label: "Track Number" },
  { id: "discNo", label: "Disc Number" },
  { id: "artwork", label: "Artwork" },
];

export type Fields = Record<FieldId, boolean>;

/** Everything on, which is what confirming a release usually means. */
export function allFields(): Fields {
  return {
    title: true,
    artist: true,
    album: true,
    albumArtist: true,
    year: true,
    trackNo: true,
    discNo: true,
    artwork: true,
  };
}

/**
 * Which remote track each selected file is paired with, by index, or null for
 * a file the release has nothing to offer.
 *
 * Per file rather than per remote track, because the files are what gets
 * written: a twelve-track release confirmed against three files has nine
 * tracks nobody is mapping to, and they are not the dialog's problem.
 */
export type Assignment = (number | null)[];

/** A file's disc, defaulting the way a single-disc release leaves it. */
function disc(value: number | null): number {
  return value ?? 1;
}

/**
 * Pairs the selected files with the release's tracks.
 *
 * By track number where the files carry one, which is the case a partial
 * selection depends on: three files numbered 5, 6 and 7 have to reach tracks
 * 5, 6 and 7 of a twelve-track release, and pairing them by position would
 * write the first three titles over them.
 *
 * By position otherwise - files with no numbers at all are exactly the ones a
 * lookup is being run for, and their order on disc is the only ordering there
 * is.
 */
export function defaultAssignment(files: Track[], remote: RemoteTrack[]): Assignment {
  const numbered = files.every((file) => file.track_no !== null);
  if (!numbered) {
    return files.map((_, index) => (index < remote.length ? index : null));
  }

  const taken = new Set<number>();
  return files.map((file) => {
    const match = remote.findIndex(
      (track, index) =>
        !taken.has(index) && track.trackNo === file.track_no && track.discNo === disc(file.disc_no),
    );
    if (match === -1) {
      return null;
    }
    taken.add(match);
    return match;
  });
}

/**
 * Swaps two files' tracks, which is what the reorder controls do.
 *
 * A swap rather than a move: the rows are the files, and they stay where they
 * are - what moves is which track each of them is about to be named after.
 */
export function swapAssignment(assignment: Assignment, from: number, to: number): Assignment {
  if (from < 0 || to < 0 || from >= assignment.length || to >= assignment.length) {
    return assignment;
  }
  const swapped = [...assignment];
  swapped[from] = assignment[to] ?? null;
  swapped[to] = assignment[from] ?? null;
  return swapped;
}

/** How many of the selected files an apply would actually write. */
export function mappedCount(assignment: Assignment): number {
  return assignment.filter((index) => index !== null).length;
}

/**
 * Turns the confirmed mapping into one edit per file.
 *
 * Only the ticked fields are set. Everything else stays absent, which is what
 * the writer reads as "leave it exactly as it is" - an unticked box must not
 * clear a tag, only decline to write one.
 *
 * A file with no track is left out entirely rather than sent as an empty edit.
 * It still gets the release's identifiers, because those are applied to every
 * file of the release on the other side of the boundary.
 */
export function buildEdits(
  files: Track[],
  detail: ReleaseDetail,
  assignment: Assignment,
  fields: Fields,
): TrackEdit[] {
  const cover: CoverEdit | null =
    fields.artwork && detail.coverPath !== null
      ? { kind: "replace", path: detail.coverPath }
      : null;

  const edits: TrackEdit[] = [];
  files.forEach((file, index) => {
    const at = assignment[index];
    if (at === null || at === undefined) {
      return;
    }
    const track = detail.tracks[at];
    if (track === undefined) {
      return;
    }

    edits.push({
      trackId: file.id,
      edit: {
        title: fields.title ? track.title : null,
        artist: fields.artist ? track.artist : null,
        album: fields.album ? detail.candidate.title : null,
        albumArtist: fields.albumArtist ? detail.albumArtist : null,
        // A release MusicBrainz has no year for leaves the field absent rather
        // than clearing whatever the files already say.
        year: fields.year && detail.year !== null ? String(detail.year) : null,
        trackNo: fields.trackNo ? String(track.trackNo) : null,
        discNo: fields.discNo ? String(track.discNo) : null,
        comment: null,
        genre: null,
        // Set on the other side, for the whole release rather than for these
        // files - see `ReleaseIdentity`.
        releaseMbid: null,
        releaseGroupMbid: null,
        cover,
      },
    });
  });
  return edits;
}

/**
 * Which release the files belong to, keyed by what the *library* calls it.
 *
 * The album and artist are the local group's, not MusicBrainz's: they are what
 * the whole-release expansion matches on, and the whole point of the lookup is
 * that the two disagree.
 */
export function identityOf(
  group: { album: string | null; artist: string | null },
  detail: ReleaseDetail,
): ReleaseIdentity {
  return {
    album: group.album,
    artist: group.artist,
    releaseMbid: detail.candidate.mbid,
    releaseGroupMbid: detail.candidate.releaseGroupMbid,
  };
}
