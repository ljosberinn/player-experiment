import type { ReactNode } from "react";

/** One segment. There is no disabled state: the sheet draws none. */
export interface Segment<Value extends string> {
  value: Value;
  label: ReactNode;
}

/**
 * A small set of exclusive choices, all of them on screen at once.
 *
 * Native radios under the drawing, like `Checkbox` and `Radio`, and for the
 * behaviour rather than the markup: a radio group is one tab stop with arrow
 * keys inside it, and that is exactly what a segmented control has to be.
 * Rebuilding it over buttons would mean a roving `tabIndex` and a key handler
 * to go with it. The inputs are transparent and cover their own segment, so
 * the pointer hits the real control.
 *
 * For two to four choices that fit. Longer than that is a `Select`: a set of
 * segments that wraps has stopped being one control to look at.
 */
export function SegmentedControl<Value extends string>({
  name,
  label,
  value,
  segments,
  onChange,
}: {
  /** What makes the set one group. Distinct per control on the page. */
  name: string;
  /** The group's accessible name, on the `<fieldset>`'s legend. */
  label: string;
  value: Value;
  segments: readonly Segment<Value>[];
  onChange: (value: Value) => void;
}) {
  return (
    // A fieldset and a legend rather than `role="radiogroup"` and an
    // `aria-label`: the grouping is what the elements already mean, and the
    // legend is a real label that follows the group if the drawing changes.
    <fieldset className="segmented">
      <legend>{label}</legend>
      {segments.map((segment) => (
        <label key={segment.value} className="segment">
          <input
            type="radio"
            name={name}
            value={segment.value}
            checked={segment.value === value}
            onChange={() => onChange(segment.value)}
          />
          {segment.label}
        </label>
      ))}
    </fieldset>
  );
}
