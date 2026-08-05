import { Slider } from "@base-ui/react/slider";
import { formatDuration } from "../../lib/format";

/**
 * The playhead: elapsed, a draggable rail, and the track's length.
 *
 * The right-hand figure is the total rather than the time remaining, which is
 * what the design shows and what the rest of the app already reports - the Time
 * column in the table is a duration, and two readings of the same song that
 * disagree is a worse thing to have on screen than a countdown is a good one.
 *
 * Renders in the idle state too, disabled and reading 0:00 - the strip is a
 * fixed row of controls, and one that appears when a song starts would move
 * everything to its right at the moment of pressing play.
 */
export function Scrubber({
  positionMs = 0,
  durationMs = 0,
  onSeek,
}: {
  positionMs?: number;
  durationMs?: number;
  onSeek?: (positionMs: number) => void;
}) {
  const elapsed = Math.max(0, Math.min(positionMs, durationMs));

  return (
    <div className="scrubber" data-testid="scrubber">
      <span className="scrubber-time">{formatDuration(elapsed)}</span>

      {/* `onValueCommitted`, not `onValueChange`, is the whole reason this
          stopped being a range input. A scrubber wants its value when the drag
          ends; `onChange` fires throughout, so dragging across a five-minute
          song used to send a seek per pixel - each one a real seek in the
          decoder, on the audio thread. */}
      <Slider.Root
        className="scrubber-track"
        min={0}
        max={Math.max(durationMs, 1)}
        step={1000}
        value={elapsed}
        disabled={!onSeek || durationMs <= 0}
        onValueCommitted={(value) => onSeek?.(typeof value === "number" ? value : elapsed)}
      >
        <Slider.Control className="scrubber-control">
          <Slider.Track className="scrubber-rail">
            <Slider.Indicator className="scrubber-fill" />
            <Slider.Thumb
              className="scrubber-thumb"
              aria-label="Seek"
              aria-valuetext={formatDuration(elapsed)}
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>

      <span className="scrubber-time">{formatDuration(durationMs)}</span>
    </div>
  );
}
