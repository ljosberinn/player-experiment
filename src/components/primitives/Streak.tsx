/** The seven days the strip always draws, whatever the answer's length. */
const WEEK = 7;

export interface StreakProps {
  /** The run ending today. Undefined until the first answer lands. */
  readonly current: number | undefined;
  /** The longest run there has been, and what the track measures against. */
  readonly longest: number | undefined;
  /** When the record ran, already in the reader's own date format. */
  readonly span?: string;
  /** Whether each of the last seven days had a play, oldest first. */
  readonly days: readonly boolean[];
  /** How a run is written out - only the caller knows the plural rule. */
  readonly format: (days: number) => string;
}

/**
 * Runs of consecutive days: the two figures, and the current one as a picture.
 *
 * Section 4c. One `<dl>` around both figures rather than one each, which is
 * {@link StatRow}'s rule for its reason - Current and Longest are one subject
 * measured twice, and two lists read as two unrelated groups.
 *
 * The caption row reprints the current run beside the record although the
 * figure above it says the same thing. The sheet draws it, and the line it is
 * on is what the track underneath is measuring.
 *
 * The seven days are the one thing here the figures do not carry, so the strip
 * is named rather than left as decoration: `role="img"` and a label, which is
 * `Heatmap`'s bargain and for the same reason - a bar is reachable by a
 * pointer and by nothing else.
 */
export function Streak({ current, longest, span, days, format }: StreakProps) {
  const run = (value: number | undefined) => (value === undefined ? "—" : format(value));
  // Zero is every library before its first play and every filter that matched
  // none, so the ratio is guarded rather than the caller being asked to.
  const share =
    current !== undefined && longest !== undefined && longest > 0 ? current / longest : 0;
  const week = Array.from({ length: WEEK }, (_, day) => days[day] === true);
  const played = week.filter(Boolean).length;

  return (
    <div className="streak">
      <dl className="streak-figures">
        <div>
          <dt>Current</dt>
          <dd>{run(current)}</dd>
        </div>
        <div>
          <dt>Longest</dt>
          <dd>{run(longest)}</dd>
          {/* Left out rather than emptied: an empty line still takes its
              height, and everything under it would sit a line lower for no
              answer. */}
          {span !== undefined && <dd className="streak-span">{span}</dd>}
        </div>
      </dl>
      <div>
        <p className="streak-caption">
          <span>Current streak · {run(current)}</span>
          <span>Record {longest === undefined ? "—" : longest.toLocaleString()}</span>
        </p>
        <div className="streak-track">
          <span className="streak-fill" style={{ width: `${share * 100}%` }} />
        </div>
        <div
          className="streak-days"
          role="img"
          aria-label={`Plays on ${played} of the last seven days`}
        >
          {week.map((on, day) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a day's index is its identity here
              key={day}
              className={on ? "streak-day on" : "streak-day"}
            />
          ))}
        </div>
        <p className="streak-week">Last seven days</p>
      </div>
    </div>
  );
}
