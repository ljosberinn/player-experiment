import type { ReactNode } from "react";

/**
 * A checkbox, drawn rather than inherited from the browser.
 *
 * The native `<input type="checkbox">` is still here and is still the control:
 * it is what carries the keyboard, the label association, the form value and
 * the `:indeterminate` state, and it is what a test finds by role. Only its
 * drawing is replaced - `appearance: none` on the input itself could not hold
 * a tick at the sheet's stroke, so the input goes transparent over a `<span>`
 * that is drawn instead. **That span is the 26px hit area** and the mark
 * inside it is 17px; see `library.css`.
 *
 * Not Base UI, unlike `Select`, `Slider` and `Switch`. There is no behaviour
 * here the platform does not already have, and a headless checkbox would be a
 * second thing to keep in step with `:checked` and `:indeterminate` for a
 * control the browser gets right.
 *
 * `label` is the visible text *and* the accessible name, and the `<label>`
 * wraps both, so clicking the word toggles the box. A row that puts its label
 * somewhere else - the settings dialog puts it at the far left of the row -
 * passes `id` instead and labels the box itself.
 */
export function Checkbox({
  id,
  label,
  checked,
  mixed = false,
  disabled = false,
  onChange,
}: {
  id?: string;
  /** Omitted when something outside the control already names it by `id`. */
  label?: ReactNode;
  checked: boolean;
  /**
   * Neither on nor off - some of what this stands for is ticked.
   *
   * Set through the DOM property rather than an attribute, because that is
   * the only way there is: `indeterminate` has no HTML attribute, and it is
   * what makes the control announce as "mixed" without an `aria-checked`
   * that would then have to be kept in step by hand.
   */
  mixed?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="checkbox">
      <input
        id={id}
        type="checkbox"
        ref={(element) => {
          if (element !== null) {
            element.indeterminate = mixed;
          }
        }}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      {/* Every state of the mark is drawn here and chosen by the input's own
          pseudo-classes, so nothing below has to agree with React about which
          of the three it is in. */}
      <span className="checkbox-box" aria-hidden="true">
        {/* The sheet's own path, at its own stroke. Inline rather than an
            entry in the icon registry: the registry is the app's iconography,
            and this is part of a control's drawing - the tick is to a
            checkbox what the dot is to a radio. `currentColor` takes the
            box's `--on-accent`. */}
        <svg
          className="checkbox-tick"
          aria-hidden="true"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
        >
          <path d="M4 12l6 6L20 6" />
        </svg>
        <span className="checkbox-bar" />
      </span>
      {label}
    </label>
  );
}
