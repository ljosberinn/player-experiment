import { Slider } from "@base-ui/react/slider";
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
          {/* `onValueCommitted`, not `onValueChange`, is the whole reason this
              stopped being a range input. A scrubber wants its value when the
              drag ends; `onChange` fires throughout, so dragging across a
              five-minute song used to send a seek per pixel - each one a real
              seek in the decoder, on the audio thread. */}
          <Slider.Root
            className="status-track"
            min={0}
            max={Math.max(duration, 1)}
            step={1000}
            value={elapsed}
            disabled={!onSeek || duration <= 0}
            onValueCommitted={(value) => onSeek?.(typeof value === "number" ? value : elapsed)}
          >
            <Slider.Control className="status-track-control">
              <Slider.Track className="status-track-rail">
                <Slider.Indicator className="status-track-fill" />
                <Slider.Thumb
                  className="status-track-thumb"
                  aria-label="Seek"
                  aria-valuetext={formatDuration(elapsed)}
                />
              </Slider.Track>
            </Slider.Control>
          </Slider.Root>
          <span className="status-time">-{formatDuration(remaining)}</span>
        </div>
      </div>
    </div>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
