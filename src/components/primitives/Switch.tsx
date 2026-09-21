import { Switch as Base } from "@base-ui/react/switch";
import { type ReactNode, useId } from "react";

/**
 * A setting that is on or off, and says which by where its knob is.
 *
 * The one control here with no native element behind it, which is why it is
 * Base UI: a `<span role="switch">` has to grow its own keyboard handling,
 * its own hidden input for a form, and `aria-checked` kept in step with the
 * drawing. `Switch.Root` renders the hidden `<input>` beside the span, so
 * `getByRole("switch")` finds it and a `<label>` names it.
 *
 * **Not a checkbox with a different skin.** A checkbox is a value in a form
 * you are filling in and takes effect when the form is saved; a switch takes
 * effect as it is thrown. The sheet draws both because they mean different
 * things.
 */
export function Switch({
  id,
  label,
  checked,
  disabled = false,
  onChange,
}: {
  id?: string;
  /** Omitted when something outside the control already names it by `id`. */
  label?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  // The label below points at the control by id rather than wrapping it: a
  // `<label>` only forwards its click to a labelable descendant, and what
  // `Base.Root` renders is a `<button>` beside a hidden input - so the
  // association has to be written down to exist at all.
  const generated = useId();
  const controlId = id ?? generated;

  const control = (
    <Base.Root
      id={controlId}
      className="switch"
      checked={checked}
      disabled={disabled}
      // Wrapped rather than handed over: Base UI calls this with the event
      // details as a second argument, and a caller passing a setter straight
      // in would be handing that object to its own store. The primitive is
      // where the library stops.
      onCheckedChange={(next) => onChange(next)}
    >
      <Base.Thumb className="switch-knob" />
    </Base.Root>
  );

  // A `<label>` only when there is something to put in it. Wrapping a bare
  // switch in an empty label would leave a clickable strip beside it with
  // nothing in it, and would fight the `id` the caller passed for the label
  // it has elsewhere.
  return label === undefined ? (
    control
  ) : (
    <label className="switch-row" htmlFor={controlId}>
      {control}
      {label}
    </label>
  );
}
