import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";

/**
 * Where the button is, not how big someone wanted it.
 *
 * The sheet states three sizes and ties each to a place: 32px square in a
 * toolbar, 36px in a dialog, 20px for the pair that nudges a row up or down
 * inside a mapping table. A fourth size would be a fourth place, which is a
 * design decision rather than a prop.
 */
export type IconButtonPlace = "toolbar" | "dialog" | "nudge";

/** The glyph each place draws, from the sheet. The 20px box gets 9px. */
const GLYPH: Record<IconButtonPlace, number> = { toolbar: 14, dialog: 14, nudge: 9 };

/**
 * `in-dialog` rather than `dialog`, which is the box this button sits in.
 * Class names are global here, so an icon button that wore `dialog` would pick
 * up `.dialog` itself - a fixed-position 912px box with a shadow - and the
 * only sign of it would be a 36px control drawn over the middle of the window.
 */
const CLASS: Record<IconButtonPlace, string> = {
  toolbar: "icon-button",
  dialog: "icon-button in-dialog",
  nudge: "icon-button nudge",
};

/**
 * A square button whose whole label is its glyph.
 *
 * `label` is required and is the accessible name: the icon itself is
 * `aria-hidden`, as every icon in this app is, so without it the control is
 * announced as "button" and nothing else. It is the one prop that cannot be
 * defaulted.
 *
 * `pressed` makes it a toggle. Passing it at all is what puts `aria-pressed`
 * on the element, so an ordinary button is not announced as an untoggled one -
 * `aria-pressed="false"` is a claim about state, and most of these have none.
 */
export function IconButton({
  icon,
  label,
  place = "toolbar",
  pressed,
  disabled = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  place?: IconButtonPlace;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={CLASS[place]}
      aria-label={label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={GLYPH[place]} />
    </button>
  );
}
