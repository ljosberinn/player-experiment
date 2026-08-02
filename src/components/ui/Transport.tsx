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

      <input
        className="volume"
        type="range"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        aria-label="Volume"
        onChange={(event) => onVolumeChange(Number(event.currentTarget.value) / 100)}
      />
    </div>
  );
}
