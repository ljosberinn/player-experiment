/** What a started-but-barely task is drawn as, in pixels. */
const SLIVER = 3;

export interface ProgressBarProps {
  /** How far along, 0 to 1. Clamped, so a caller's arithmetic cannot overrun. */
  readonly ratio: number;
  /** How wide the rail is, in pixels. */
  readonly width: number;
}

/**
 * The 4px rail, filled to a fraction.
 *
 * Section 05. The width is the caller's rather than the container's: a rail
 * that stretches to whatever holds it draws a fraction of a percent as an
 * invisible mark, and the sheet gives the two places it appears - the task
 * line and the review pane - different measures.
 *
 * Anything under way is drawn at three pixels at least, which is what the
 * sheet draws for 0,22%: a quarter of a pixel is nothing at all, and "started"
 * and "not started" are the one distinction a rail this short is for.
 *
 * `aria-hidden`, and it takes no label. Both callers print the same figure in
 * words on the line beside it, so the bar is the picture of a sentence that is
 * already there.
 */
export function ProgressBar({ ratio, width }: ProgressBarProps) {
  const share = Math.min(1, Math.max(0, ratio));

  return (
    <div className="progress" style={{ width: `${width}px` }} aria-hidden="true">
      <span
        className="progress-fill"
        style={{ width: `${share * 100}%`, minWidth: share > 0 ? `${SLIVER}px` : 0 }}
      />
    </div>
  );
}
