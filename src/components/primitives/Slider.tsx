import { Slider as Base } from "@base-ui/react/slider";

/**
 * A percentage, which is what an unqualified 0-100 is.
 *
 * Out here rather than a default in the parameter list: React Compiler
 * refuses an arrow function there - it cannot prove one is safe to reorder -
 * and skips the whole component, which is worse than a named constant.
 */
const asPercentage = (reading: number) => `${reading}%`;

/**
 * A number chosen by dragging, with the number beside it.
 *
 * Base UI, like the two rails in the transport strip and for the reason phase
 * 24 gave: a range input reports throughout a drag, and everything else about
 * a slider - the keyboard steps, the ARIA, the pointer capture - is behaviour.
 *
 * **Not the transport treatment.** `Scrubber` and `VolumeControl` draw the
 * playhead and the volume rail, which the design gives their own shape; this
 * is the sheet's generic slider - a 3px rail, an 11px square ink knob above
 * it, and a tabular readout at the right. The two look different on purpose
 * and neither should be made to borrow from the other.
 *
 * The rail carries no edge, unlike the transport's. What identifies the
 * control is the accent fill and the knob - 4.4:1 and 13:1 at the worst of
 * the four surfaces - so the groove behind them is decoration rather than the
 * thing WCAG 1.4.11 asks 3:1 of; see `--rail` in `tokens.css`.
 *
 * `onChange` reports as the knob moves. A caller whose write is expensive -
 * a seek, a query - wants `onCommit`, which fires once when the drag ends.
 */
export function Slider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  format = asPercentage,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** The readout, and the `aria-valuetext` that goes with it. */
  format?: (value: number) => string;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
}) {
  // Base UI's value is a number or a range; this primitive is deliberately
  // one-handled, so both callbacks flatten it here rather than at every call
  // site. A range slider is a different control and would say so.
  const single = (next: number | readonly number[]) =>
    typeof next === "number" ? next : (next[0] ?? value);

  return (
    <Base.Root
      className="slider"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      {...(onChange === undefined ? {} : { onValueChange: (next) => onChange(single(next)) })}
      {...(onCommit === undefined ? {} : { onValueCommitted: (next) => onCommit(single(next)) })}
    >
      <Base.Control className="slider-control">
        <Base.Track className="slider-rail">
          <Base.Indicator className="slider-fill" />
          <Base.Thumb className="slider-knob" aria-label={label} aria-valuetext={format(value)} />
        </Base.Track>
      </Base.Control>
      {/* Not the thumb's `aria-valuetext` repeated for a screen reader - it is
          read from the thumb already. This is the same reading for the eye. */}
      <span className="slider-readout" aria-hidden="true">
        {format(value)}
      </span>
    </Base.Root>
  );
}
