import { Icon } from "../icons/Icon";

/**
 * Love, for what is playing, after its title and artist.
 *
 * The same toggle the row menu's Love entry is, drawn as a heart: `aria-pressed`
 * says loved, and a song with no artist and title - which `plays::match_key`
 * cannot key - greys it with the menu's own hint.
 *
 * Hidden rather than absent with nothing playing, like the box beside it.
 */
export function LoveButton({
  loved = false,
  hint,
  hidden = false,
  onToggle,
}: {
  loved?: boolean;
  /** Why it is refused. Disables the button. */
  hint?: string | undefined;
  hidden?: boolean;
  onToggle?: () => void;
}) {
  return (
    <button
      type="button"
      className="love-button"
      aria-label="Love"
      aria-pressed={loved}
      title={hint}
      disabled={hint !== undefined || !onToggle}
      onClick={onToggle}
      style={hidden ? { visibility: "hidden" } : undefined}
    >
      <Icon name={loved ? "loved" : "love"} size={17} />
    </button>
  );
}
