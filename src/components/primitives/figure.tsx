/**
 * A number with its unit riding inside it.
 *
 * Shared by both of section 4a's drawings, because the rule is one rule: the
 * unit is part of the answer, so it belongs in the same definition rather than
 * on a line of its own. It is drawn smaller than the number either way; what
 * the two forms differ on is only how much.
 *
 * A word unit takes a space and a symbol does not - "1.5 yrs" against "68%" -
 * which is the sheet's own typography in both drawings and is a property of
 * the unit rather than of the form it is drawn in, so it is decided here.
 */
export function StatFigure({ value, unit }: { value: string; unit: string | undefined }) {
  if (unit === undefined) {
    return value;
  }
  return (
    <>
      {/^\p{L}/u.test(unit) ? `${value} ` : value}
      <span className="stat-unit">{unit}</span>
    </>
  );
}
