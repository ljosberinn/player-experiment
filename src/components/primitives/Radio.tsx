import type { ReactNode } from "react";

/**
 * One choice out of several, drawn the way the sheet draws it.
 *
 * A square with a square dot in it, which is not an oversight: radius is 0
 * everywhere in this design and a radio is the one control that would have
 * argued for an exception. It reads as a radio because of where it appears
 * and because the dot is inset from an accent ring, not because it is round.
 *
 * Native, like `Checkbox` and for the same reason: `name` is what makes a set
 * of these one control, and the browser's own grouping gives arrow-key
 * navigation, the roving tab stop and "exactly one of these" for free. A
 * headless radio group would re-implement all three.
 *
 * Nothing in the app uses one yet - there is no native radio to replace. It
 * is here because the sheet specifies it and because the alternative is the
 * first caller inventing one.
 */
export function Radio({
  name,
  value,
  label,
  checked,
  disabled = false,
  onChange,
}: {
  /** What makes a set of these one control. Every member shares it. */
  name: string;
  value: string;
  label?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="radio">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <span className="radio-box" aria-hidden="true">
        <span className="radio-dot" />
      </span>
      {label}
    </label>
  );
}
