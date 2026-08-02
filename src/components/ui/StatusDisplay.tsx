import type { Track } from "../../ipc";
import { coverUrl } from "../../ipc";
import { formatDuration } from "../../lib/format";

/**
 * The centred display from iTunes' toolbar.
 *
 * Shows the current track, or a library summary when nothing is playing -
 * playback itself arrives in phase 4, so the scrubber is presentational here.
 */
export function StatusDisplay({
  track,
  positionMs,
  summary,
}: {
  track: Track | null;
  positionMs?: number;
  summary: string;
}) {
  if (!track) {
    return (
      <div className="status-display" data-testid="status-display">
        <span className="status-summary">{summary}</span>
      </div>
    );
  }

  const elapsed = positionMs ?? 0;
  const remaining = Math.max(0, track.duration_ms - elapsed);
  const progress = track.duration_ms > 0 ? (elapsed / track.duration_ms) * 100 : 0;

  return (
    <div className="status-display" data-testid="status-display">
      {track.cover_hash ? (
        <img className="status-cover" src={coverUrl(track.cover_hash)} alt="" />
      ) : (
        <div className="status-cover status-cover-empty" aria-hidden="true" />
      )}

      <div className="status-text">
        <div className="status-title">{track.title ?? fileName(track.path)}</div>
        <div className="status-subtitle">
          {[track.artist, track.album].filter(Boolean).join(" — ") || " "}
        </div>
        <div className="status-scrubber">
          <span className="status-time">{formatDuration(elapsed)}</span>
          <div className="status-track">
            <div className="status-progress" style={{ width: `${progress}%` }} />
          </div>
          <span className="status-time">-{formatDuration(remaining)}</span>
        </div>
      </div>
    </div>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
