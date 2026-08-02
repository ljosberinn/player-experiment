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

/** "237 songs, 19.2 hours, 2.27 GB" - the footer line from iTunes. */
export function formatLibrarySummary(count: number, totalMs: number): string {
  const songs = `${count.toLocaleString()} ${count === 1 ? "song" : "songs"}`;
  if (count === 0) {
    return "No songs";
  }

  const hours = totalMs / 3_600_000;
  const duration =
    hours >= 1 ? `${hours.toFixed(1)} hours` : `${Math.round(totalMs / 60_000)} minutes`;

  return `${songs}, ${duration}`;
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
