import type { ReactNode } from "react";

/** One row: what it is, what it belongs to, and how much of it there is. */
export interface BarListEntry {
  readonly key: string;
  /** The artist behind an album or a track. Absent for artists and genres. */
  readonly secondary?: string | null;
  readonly value: number;
}

export interface BarListProps {
  readonly entries: readonly BarListEntry[];
  /** How each value is written out - a count, a share, a duration. */
  readonly format: (value: number) => string;
  /** Makes each row a button. Omitted where a row leads nowhere. */
  readonly onSelect?: (entry: BarListEntry) => void;
  /** What the rows cover, where that is less than everything. */
  readonly caption?: ReactNode;
  readonly empty: string;
  readonly loading?: boolean;
}

/**
 * A ranked list with the share drawn behind each row.
 *
 * HTML rather than SVG, and deliberately not inside `ChartFrame`. `ChartFrame`
 * owns `role="img"` and the show-as-table toggle so that no chart can ship
 * without either - but a ranked list is already the table, and wrapping it in
 * one `role="img"` would take away the reading it has: names that truncate,
 * rows that take focus, and an ordered list a screen reader can walk.
 *
 * The fill is a share of the largest value rather than of the total, because
 * the question a top list answers is how the rows compare to each other. Ten
 * rows of a long tail would otherwise all be a sliver.
 */
export function BarList({
  entries,
  format,
  onSelect,
  caption,
  empty,
  loading = false,
}: BarListProps) {
  if (loading && entries.length === 0) {
    return (
      <div className="bar-list bar-list-loading">
        {/* Rows rather than one block, so the panel keeps its height and the
            view does not jump when the answer lands. */}
        {Array.from({ length: 5 }, (_, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a skeleton row has no identity
          <div key={row} className="bar-list-skeleton" data-testid="bar-list-skeleton" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return <p className="empty-state">{empty}</p>;
  }

  // Never zero: every entry is something that was heard at least once, and a
  // zero here would divide the whole list into NaN.
  const largest = Math.max(...entries.map((entry) => entry.value), 1);

  return (
    <div className="bar-list">
      <ol>
        {entries.map((entry) => {
          const share = `${(entry.value / largest) * 100}%`;
          const body = (
            <>
              <span className="bar-list-fill" style={{ width: share }} />
              <span className="bar-list-label">
                {entry.key}
                {entry.secondary !== undefined && entry.secondary !== null && (
                  <span className="bar-list-secondary">{entry.secondary}</span>
                )}
              </span>
              <span className="bar-list-value">{format(entry.value)}</span>
            </>
          );

          return (
            <li key={`${entry.key}${entry.secondary ?? ""}`}>
              {onSelect === undefined ? (
                <div className="bar-list-row">{body}</div>
              ) : (
                <button type="button" className="bar-list-row" onClick={() => onSelect(entry)}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {caption !== undefined && <p className="bar-list-caption">{caption}</p>}
    </div>
  );
}
