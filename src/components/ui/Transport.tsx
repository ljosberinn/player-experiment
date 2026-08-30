import { Icon } from "../icons/Icon";

/**
 * The prev / play / next pill.
 *
 * A rounded capsule holding three round buttons, the middle one filled with the
 * accent and larger than its neighbours - the design's most prominent control,
 * and since phase 35 the leftmost thing on the transport strip.
 *
 * The glyphs come from the icon set, filled. They were drawn in CSS - three
 * rectangles and three triangles - which was right against the alternative at
 * the time, text in whichever font on the machine carried the geometric-shapes
 * block. It is not right against a library the rest of the chrome now uses.
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
        <Icon name="previous" size={18} />
      </button>

      <button
        type="button"
        className="transport-play"
        aria-label={playing ? "Pause" : "Play"}
        disabled={!onPlayPause}
        onClick={onPlayPause}
      >
        <Icon name={playing ? "pause" : "play"} size={22} />
      </button>

      <button
        type="button"
        className="transport-step"
        aria-label="Next"
        disabled={!onNext}
        onClick={onNext}
      >
        <Icon name="next" size={18} />
      </button>
    </div>
  );
}
