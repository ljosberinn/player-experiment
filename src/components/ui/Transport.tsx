/**
 * The prev / play / next pill.
 *
 * A rounded capsule holding three round buttons, the middle one filled with the
 * accent and larger than its neighbours - the design's most prominent control,
 * and since phase 35 the leftmost thing on the transport strip.
 *
 * The glyphs are drawn in CSS rather than set as text. The previous version used
 * the geometric-shapes block (&#9664;&#9654;) and inherited whichever font on the
 * machine happened to carry them, at whatever size and baseline that font chose.
 * Three rectangles and three triangles are cheaper to get exactly right.
 *
 * Handlers are optional and a button without one disables itself, so the chrome
 * can never show a control that silently does nothing.
 */
export function Transport({
  playing = false,
  onPrevious,
  onPlayPause,
  onNext,
}: {
  playing?: boolean;
  onPrevious?: () => void;
  onPlayPause?: () => void;
  onNext?: () => void;
}) {
  return (
    <div className="transport">
      <button
        type="button"
        className="transport-step"
        aria-label="Previous"
        disabled={!onPrevious}
        onClick={onPrevious}
      >
        <span className="icon-prev" aria-hidden="true" />
      </button>

      <button
        type="button"
        className="transport-play"
        aria-label={playing ? "Pause" : "Play"}
        disabled={!onPlayPause}
        onClick={onPlayPause}
      >
        <span className={playing ? "icon-pause" : "icon-play"} aria-hidden="true" />
      </button>

      <button
        type="button"
        className="transport-step"
        aria-label="Next"
        disabled={!onNext}
        onClick={onNext}
      >
        <span className="icon-next" aria-hidden="true" />
      </button>
    </div>
  );
}
