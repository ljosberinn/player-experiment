/**
 * Repeat one, at the right of the transport strip.
 *
 * One toggle with one meaning: off, or this song forever. There is no
 * repeat-all and no shuffle here, and none is coming - a queue that reorders
 * itself is not what this player is for.
 *
 * `aria-pressed` rather than a second button or a changed label: it is one
 * control in two states, and the state is what a screen reader has to hear.
 * The glyph carries a "1" so the sighted reading is the same as the spoken one
 * - two loops of an arrow would be repeat-all in every other player.
 */
export function RepeatButton({
  repeating = false,
  onToggle,
}: {
  repeating?: boolean;
  onToggle?: () => void;
}) {
  return (
    <button
      type="button"
      className="repeat-button"
      aria-label="Repeat one"
      aria-pressed={repeating}
      disabled={!onToggle}
      onClick={onToggle}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
        {/* A rounded rectangle broken at the top right, where the arrowhead
            goes, drawn as one open path so the corners stay even. */}
        <path
          d="M10.5 2.5H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path d="M8.6 0.7 11 2.5 8.6 4.3z" fill="currentColor" />
        {/* The 1, set rather than drawn: it is a numeral, and the face it is
            set in comes from `.repeat-button text` in App.css - a `var()` in a
            presentation attribute here would not resolve. */}
        <text x="8" y="11.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor">
          1
        </text>
      </svg>
    </button>
  );
}
