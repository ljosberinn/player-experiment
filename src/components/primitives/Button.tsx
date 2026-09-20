import type { ReactNode } from "react";

/**
 * The kinds, in the order the specimen sheet draws them.
 *
 * Not a visual preference: each one says how much of the surface's attention
 * the action is entitled to. **At most one primary per surface** - the whole
 * point of a solid accent fill is that there is one of it, and two make both
 * of them ordinary. Nothing can check that from here; it is checked by reading
 * the surface, and the story draws the row so the comparison is available.
 */
export type ButtonKind = "primary" | "secondary" | "ghost";

/**
 * A button, the way the component library draws one.
 *
 * `type="button"` by default and stated rather than inherited: a bare
 * `<button>` inside a form is a submit button, which is how a dialog's Cancel
 * comes to save. A caller that genuinely wants to submit says so.
 *
 * A disabled button is drawn as a dimmed secondary whatever kind it asked
 * for, so `kind` stays what the action *is* rather than what it currently
 * looks like.
 */
export function Button({
  kind = "secondary",
  type = "button",
  disabled = false,
  onClick,
  children,
}: {
  kind?: ButtonKind;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button type={type} className={`button ${kind}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
