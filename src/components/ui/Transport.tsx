import { Slider } from "@base-ui/react/slider";
/**
 * Transport controls and volume.
 *
 * Handlers are optional and a button without one disables itself, so the
 * chrome can never show a control that silently does nothing.
 */
export function Transport({
  playing = false,
  volume,
  onPrevious,
  onPlayPause,
  onNext,
  onVolumeChange,
}: {
  playing?: boolean;
  volume: number;
  onPrevious?: () => void;
  onPlayPause?: () => void;
  onNext?: () => void;
  onVolumeChange: (volume: number) => void;
}) {
  return (
    <div className="transport">
      <button type="button" aria-label="Previous" disabled={!onPrevious} onClick={onPrevious}>
        &#9664;&#9664;
      </button>
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        disabled={!onPlayPause}
        onClick={onPlayPause}
      >
        {playing ? "❙❙" : "▶"}
      </button>
      <button type="button" aria-label="Next" disabled={!onNext} onClick={onNext}>
        &#9654;&#9654;
      </button>

      {/* `onValueChange`, unlike the scrubber's `onValueCommitted`: volume is
          meant to be heard as it moves, and setting it is a cheap write to the
          sink rather than a seek. */}
      <Slider.Root
        className="volume"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onValueChange={(value) =>
          onVolumeChange((typeof value === "number" ? value : (value[0] ?? 0)) / 100)
        }
      >
        <Slider.Control className="volume-control">
          <Slider.Track className="volume-rail">
            <Slider.Indicator className="volume-fill" />
            <Slider.Thumb className="volume-thumb" aria-label="Volume" />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </div>
  );
}
