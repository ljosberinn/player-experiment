import { Icon } from "../icons/Icon";

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
 * - two loops of an arrow would be repeat-all in every other player. It was a
 * hand-authored inline svg for exactly that reason, back when the alternative
 * was a bare loop; the icon set carries the numeral itself.
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
      <Icon name="repeat-one" size={15} />
    </button>
  );
}
