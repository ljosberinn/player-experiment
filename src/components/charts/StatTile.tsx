/**
 * One number with its name: the headline form, where a chart would be a chart
 * of one datum.
 *
 * A `<dl>` rather than two spans, so the pair is a pair to a screen reader as
 * well as to the eye - a row of six tiles is otherwise twelve announcements in
 * no stated relation.
 */
export interface StatTileProps {
  readonly label: string;
  /** Formatted by the caller: only the panel knows whether this is a count,
   * a duration or a byte size. */
  readonly value: string;
  /** A second line under the value - a share, a comparison, a caveat. */
  readonly secondary?: string;
}

export function StatTile({ label, value, secondary }: StatTileProps) {
  return (
    <dl className="stat-tile">
      <dt>{label}</dt>
      <dd className="stat-tile-value">{value}</dd>
      {secondary !== undefined && <dd className="stat-tile-secondary">{secondary}</dd>}
    </dl>
  );
}
