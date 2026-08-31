/** `m:ss`, or `h:mm:ss` once a track passes an hour. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;

/**
 * A total play time in the largest unit that still reads as a quantity.
 *
 * Every rung holds until the next unit reaches two of itself, so the number
 * never drops below 2.0 on a switch and a large library reports "3.4 weeks"
 * rather than four digits of hours.
 *
 * No months: a month has no fixed length, so weeks step straight to years.
 */
function formatSpan(totalMs: number): string {
  if (totalMs < HOUR) {
    return `${Math.round(totalMs / MINUTE)} minutes`;
  }
  if (totalMs < 2 * DAY) {
    return `${(totalMs / HOUR).toFixed(1)} hours`;
  }
  if (totalMs < 2 * WEEK) {
    return `${(totalMs / DAY).toFixed(1)} days`;
  }
  if (totalMs < YEAR) {
    return `${(totalMs / WEEK).toFixed(1)} weeks`;
  }
  return `${(totalMs / YEAR).toFixed(1)} years`;
}

/**
 * "237 songs, 19.2 hours, 2.27 GB" - the footer line from iTunes.
 *
 * `bytes` is optional because the toolbar display has room for two facts and
 * the status bar has room for three, not because a caller may omit what it
 * knows.
 */
export function formatLibrarySummary(count: number, totalMs: number, bytes?: number): string {
  if (count === 0) {
    return "No songs";
  }

  const songs = `${count.toLocaleString()} ${count === 1 ? "song" : "songs"}`;

  const parts = [songs, formatSpan(totalMs)];
  // Zero is a real answer for duration - a library of empty files - but for
  // size it means the scanner has not recorded one, and "0 MB" beside 237
  // songs reads as a bug rather than as a fact.
  if (bytes !== undefined && bytes > 0) {
    parts.push(formatBytes(bytes));
  }
  return parts.join(", ");
}

/**
 * The last segment of a path, for a track with no title tag.
 *
 * Splits on both separators: paths come from the scanner as the OS gave them,
 * and a library imported from another machine can carry either.
 */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Bytes as the human-facing unit, matching the sizes shown in the footer. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 MB";
  }
  const gb = bytes / 1_000_000_000;
  if (gb >= 1) {
    return `${gb.toFixed(2)} GB`;
  }
  return `${Math.round(bytes / 1_000_000)} MB`;
}
