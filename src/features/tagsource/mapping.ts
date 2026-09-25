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

// `score.rs`'s duration thresholds, restated rather than asked for: the page
// already holds both sides of the mapping.
const EXACT_MS = 2_000;
const TOLERANCE_MS = 30_000;

// The number outweighs either other signal and not both, so a number the
// title and length both contradict loses to them.
const NUMBER_WEIGHT = 0.4;
const DURATION_WEIGHT = 0.3;
const TITLE_WEIGHT = 0.3;
// One signal in full, or several in part.
const FLOOR = 0.3;

function durationAgreement(file: Track, track: RemoteTrack): number {
  if (file.duration_ms <= 0 || track.durationMs === null) {
    return 0;
  }
  const difference = Math.abs(file.duration_ms - track.durationMs);
  if (difference <= EXACT_MS) {
    return 1;
  }
  if (difference >= TOLERANCE_MS) {
    return 0;
  }
  return 1 - (difference - EXACT_MS) / (TOLERANCE_MS - EXACT_MS);
}

function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * The file's title tag, or its filename less a leading track number: a file
 * with no tags is the one a lookup is most likely being run for.
 */
function localTitle(file: Track): string {
  if (file.title) {
    return normalizeTitle(file.title);
  }
  const stem = (file.path.split(/[\\/]/).pop() ?? "").replace(/\.[^.]*$/, "");
  return normalizeTitle(stem.replace(/^\d{1,3}(?:[-.]\d{1,3})?(?:[\s._-]+|$)/, ""));
}

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index < text.length - 1; index++) {
    const pair = text.slice(index, index + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** Sørensen–Dice over character bigrams, which shrugs off "(Remastered)". */
function titleAgreement(local: string, remote: string): number {
  if (local === "" || remote === "") {
    return 0;
  }
  if (local === remote) {
    return 1;
  }
  const a = bigrams(local);
  const b = bigrams(remote);
  let shared = 0;
  for (const [pair, count] of a) {
    shared += Math.min(count, b.get(pair) ?? 0);
  }
  const total = local.length - 1 + (remote.length - 1);
  return total > 0 ? (2 * shared) / total : 0;
}

/**
 * Pairs the selected files with the release's tracks by what they are.
 *
 * Every pair is scored on track number, length and title, and pairs are taken
 * best first. The number alone is what a partial selection depends on - three
 * files numbered 5, 6 and 7 have to reach tracks 5, 6 and 7 of a twelve-track
 * release - but it is also the key least worth trusting in a release that
 * needed a lookup, so a number the title and length disagree with loses.
 *
 * A pair below the floor stays unpaired: a wrong pairing is the one somebody
 * applies without reading it. Equal scores go to the pair nearest the
 * diagonal, so files nothing tells apart pair by position.
 */
export function defaultAssignment(files: Track[], remote: RemoteTrack[]): Assignment {
  const remoteTitles = remote.map((track) => normalizeTitle(track.title));
  const pairs: { file: number; track: number; score: number }[] = [];

  files.forEach((file, fileIndex) => {
    const title = localTitle(file);
    remote.forEach((track, trackIndex) => {
      const numbered =
        file.track_no !== null &&
        track.trackNo === file.track_no &&
        track.discNo === disc(file.disc_no);
      const score =
        (numbered ? NUMBER_WEIGHT : 0) +
        DURATION_WEIGHT * durationAgreement(file, track) +
        TITLE_WEIGHT * titleAgreement(title, remoteTitles[trackIndex] ?? "");
      if (score >= FLOOR) {
        pairs.push({ file: fileIndex, track: trackIndex, score });
      }
    });
  });

  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      Math.abs(a.file - a.track) - Math.abs(b.file - b.track) ||
      a.file - b.file,
  );

  const assignment: Assignment = files.map(() => null);
  const taken = new Set<number>();
  for (const pair of pairs) {
    if (assignment[pair.file] === null && !taken.has(pair.track)) {
      assignment[pair.file] = pair.track;
      taken.add(pair.track);
    }
  }
  return assignment;
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

/**
 * Whether a file already carries its track's ticked per-track fields, so its
 * row holds nothing to check.
 *
 * The album, album artist, year and artwork are left out: they are the
 * release's, written alike to every file, so they tell no row apart.
 */
export function agrees(file: Track, track: RemoteTrack, fields: Fields): boolean {
  return (
    (!fields.title || file.title === track.title) &&
    (!fields.artist || file.artist === track.artist) &&
    (!fields.trackNo || file.track_no === track.trackNo) &&
    (!fields.discNo || disc(file.disc_no) === track.discNo)
  );
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
        // No checkbox offers it, so the dialog never writes it. The unattended
        // pass is what fills it in.
        releaseType: null,
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
