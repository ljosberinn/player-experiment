import type { ReactNode, Ref } from "react";

/**
 * The kinds, in the order the specimen sheet draws them.
 *
 * Not a visual preference: each one says how much of the surface's attention
 * the action is entitled to. **At most one primary per surface** - the whole
 * point of a solid accent fill is that there is one of it, and two make both
 * of them ordinary. Nothing can check that from here; it is checked by reading
 * the surface, and the story draws the row so the comparison is available.
 *
 * `destructive` is the one the sheet does not draw. It is here because
 * `ConfirmDialog` asks a question whose yes cannot be undone, and the app has
 * always answered that in `--destructive`; phase 113 took away the
 * `.modal-actions .destructive` rule it used to live in, and a fourth kind is
 * the only place left that is not a caller inventing its own fill.
 */
export type ButtonKind = "primary" | "secondary" | "ghost" | "destructive";

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
 *
 * `ref` is forwarded because a dialog's Cancel is the button its popup opens
 * focused on, and Base UI reads that ref while the popup is opening - see
 * `ConfirmDialog`. It and the two `aria-` props are the ones here that exist
 * for a caller's plumbing rather than for the drawing.
 */
export function Button({
  kind = "secondary",
  type = "button",
  disabled = false,
  title,
  onClick,
  ref,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  children,
}: {
  kind?: ButtonKind;
  type?: "button" | "submit";
  disabled?: boolean;
  /**
   * A tooltip, for the rare label that cannot say the whole thing.
   *
   * Not an accessible name - the label is that - and not a place to repeat it.
   * "Set Aside" in the lookup is the one this exists for: two words that
   * cannot say which queue is being left.
   */
  title?: string | undefined;
  onClick?: () => void;
  ref?: Ref<HTMLButtonElement> | undefined;
  /** For a label every row repeats, such as Remove down a list of folders. */
  "aria-label"?: string | undefined;
  "aria-describedby"?: string | undefined;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      className={`button ${kind}`}
      disabled={disabled}
      title={title}
      onClick={onClick}
      ref={ref}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
    >
      {children}
    </button>
  );
}
