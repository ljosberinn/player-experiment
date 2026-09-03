import type { TagEdit, TagValueField, Track } from "../../ipc";

/**
 * The editable tag fields, and how a value shared across a selection is
 * decided.
 *
 * Pure and separate from the dialog: "what does this field show when the five
 * selected tracks disagree" is the question the whole bulk editor turns on.
 */

export type FieldId =
  | "title"
  | "artist"
  | "album"
  | "albumArtist"
  | "genre"
  | "comment"
  | "year"
  | "trackNo"
  | "discNo";

export interface FieldDef {
  id: FieldId;
  label: string;
  /** The `Track` property this field reads, which is snake_case over IPC. */
  read: (track: Track) => string | number | null;
  numeric?: boolean;
  /**
   * Which vocabulary of existing values to suggest, if any.
   *
   * Only the fields where two songs genuinely ought to agree. Title, comment,
   * track number and disc number are per-song by nature: a dropdown of other
   * songs' comments is noise at best and a way to paste the wrong data at
   * worst, so those carry no vocabulary and get no listbox at all.
   */
  suggest?: TagValueField;
}

export const FIELDS: FieldDef[] = [
  { id: "title", label: "Name", read: (t) => t.title },
  { id: "artist", label: "Artist", read: (t) => t.artist, suggest: "artist" },
  { id: "album", label: "Album", read: (t) => t.album, suggest: "album" },
  { id: "albumArtist", label: "Album Artist", read: (t) => t.album_artist, suggest: "albumArtist" },
  { id: "genre", label: "Genre", read: (t) => t.genre, suggest: "genre" },
  { id: "comment", label: "Comment", read: (t) => t.comment },
  { id: "year", label: "Year", read: (t) => t.year, numeric: true, suggest: "year" },
  { id: "trackNo", label: "Track Number", read: (t) => t.track_no, numeric: true },
  { id: "discNo", label: "Disc Number", read: (t) => t.disc_no, numeric: true },
];

/**
 * What a field holds across the whole selection.
 *
 * `mixed` is not "no value" - it is "several", and the difference matters: a
 * mixed field must be left alone on save, while an empty one the user cleared
 * must be written as a clear.
 */
export type Common = { kind: "same"; value: string } | { kind: "mixed" };

export function commonValue(tracks: Track[], field: FieldDef): Common {
  const first = asString(field.read(tracks[0] as Track));
  for (const track of tracks) {
    if (asString(field.read(track)) !== first) {
      return { kind: "mixed" };
    }
  }
  return { kind: "same", value: first };
}

function asString(value: string | number | null): string {
  return value === null ? "" : String(value);
}

/** The fields the user has actually typed into; everything else is untouched. */
export type Draft = Partial<Record<FieldId, string>>;

/**
 * Turns a draft into the payload the backend expects.
 *
 * Only touched fields appear. That is the entire mixed-value contract: a
 * field the user never went near is absent, and the backend leaves it exactly
 * as it is on every track in the selection.
 */
export function toEdit(draft: Draft): TagEdit {
  const edit: TagEdit = {
    title: null,
    artist: null,
    album: null,
    albumArtist: null,
    genre: null,
    comment: null,
    year: null,
    trackNo: null,
    discNo: null,
    // No editor field sets these; only the release lookup knows them.
    releaseMbid: null,
    releaseGroupMbid: null,
    cover: null,
  };
  for (const [field, value] of Object.entries(draft)) {
    if (value !== undefined) {
      edit[field as FieldId] = value;
    }
  }
  return edit;
}

/** Whether the draft would write anything at all. */
export function hasChanges(draft: Draft, cover: TagEdit["cover"]): boolean {
  return cover !== null || Object.values(draft).some((value) => value !== undefined);
}

/**
 * A one-line summary of a rejected numeric field, so the dialog can refuse
 * before a round trip.
 *
 * The backend validates this too - it has to, since it is the last line - but
 * an error that arrives after 500 files have been considered is a worse error.
 */
export function numericProblem(draft: Draft): string | null {
  for (const field of FIELDS) {
    const value = draft[field.id];
    if (!field.numeric || value === undefined || value.trim() === "") {
      continue;
    }
    if (!/^-?\d+$/.test(value.trim())) {
      return `${field.label} must be a number, or empty to clear.`;
    }
  }
  return null;
}
