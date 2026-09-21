import { ProgressBar } from "./ProgressBar";

/** The sheet's measure for the rail, and the reason it is a measure at all. */
const RAIL = 118;

export interface TaskLineProps {
  /** What is running, with how far it has got. */
  readonly headline: string;
  /** How much longer, or nothing while the estimate has no answer yet. */
  readonly estimate: string | null;
  /** How far along, 0 to 1. */
  readonly ratio: number;
}

/**
 * The readout for a background task: two lines and a rail.
 *
 * Section 05. Two lines rather than the one string this used to join, because
 * an estimate on the end of a percentage read as a third clause of the label -
 * "Looking up and filing releases · 0.22% · about 44 hours left" is one
 * sentence about three different things.
 *
 * The rail is a fixed 118px and not the width of whatever holds it. At the
 * sidebar's width a pass that is a fifth of a percent in would be a mark two
 * pixels from the left edge of a rule running the whole way across, which
 * reads as an ornament rather than as a measure.
 */
export function TaskLine({ headline, estimate, ratio }: TaskLineProps) {
  return (
    <div className="task-line">
      <p className="task-line-text">
        {headline}
        {estimate === null ? null : (
          <>
            <br />
            {estimate}
          </>
        )}
      </p>
      <ProgressBar ratio={ratio} width={RAIL} />
    </div>
  );
}
