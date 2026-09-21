import { StatFigure } from "./figure";

/** One column of the row: a small label over a loud number. */
export interface StatFigureProps {
  readonly label: string;
  /** Formatted by the caller: only the panel knows whether this is a count,
   * a duration or a byte size. */
  readonly value: string;
  /** Drawn smaller and muted, riding on the figure rather than under it. */
  readonly unit?: string;
}

/**
 * The headline figures of a page, on a shared baseline under one rule.
 *
 * Section 4a's upper drawing, and the one that carries no prose: a figure
 * with something to qualify it belongs in {@link StatTiles} instead, which is
 * how the sheet itself splits the Listening tab's seven numbers.
 *
 * One `<dl>` around the set rather than one per column. Four lists are four
 * unrelated groups, and the row is one subject counted four ways - the same
 * reason the tiles are one list.
 */
export function StatRow({ figures }: { figures: readonly StatFigureProps[] }) {
  return (
    <dl className="stat-row">
      {figures.map((figure) => (
        <div key={figure.label}>
          <dt>{figure.label}</dt>
          <dd>
            <StatFigure value={figure.value} unit={figure.unit} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
