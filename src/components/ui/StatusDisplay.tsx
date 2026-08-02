import type { Track } from "../../ipc";
import { coverUrl } from "../../ipc";
import { formatDuration } from "../../lib/format";

/**
 * The centred display from iTunes' toolbar.
 *
 * Shows the current track and a seekable scrubber, or a library summary when
 * nothing is playing.
 */
export function StatusDisplay({
  track,
  positionMs = 0,
  summary,
  onSeek,
}: {
  track: Track | null;
  positionMs?: number;
  summary: string;
  onSeek?: (positionMs: number) => void;
}) {
  if (!track) {
    return (
      <div className="status-display" data-testid="status-display">
        <span className="status-summary">{summary}</span>
      </div>
    );
  }

  const duration = track.duration_ms;
  const elapsed = Math.max(0, Math.min(positionMs, duration));
  const remaining = Math.max(0, duration - elapsed);

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
          {/* A range input rather than a styled div: it is draggable, keyboard
              operable and announced as a slider without any extra work. */}
          <input
            className="status-track"
            type="range"
            min={0}
            max={Math.max(duration, 1)}
            step={1000}
            value={elapsed}
            aria-label="Seek"
            aria-valuetext={formatDuration(elapsed)}
            disabled={!onSeek || duration <= 0}
            onChange={(event) => onSeek?.(Number(event.currentTarget.value))}
          />
          <span className="status-time">-{formatDuration(remaining)}</span>
        </div>
      </div>
    </div>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
