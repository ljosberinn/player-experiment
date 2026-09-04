import type { BackgroundTask } from "../../ipc";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How far a task has got, to two decimal places.
 *
 * Two, because one whole percent of the unattended lookup pass is eighty
 * releases and the better part of half an hour. A figure that does not move
 * for half an hour reads as hung, and the readout exists to say the opposite.
 *
 * A total of nought is a task that has not said how much there is to do yet,
 * which is not a fraction worth drawing.
 */
export function taskPercent(done: number, total: number): string | null {
  if (total === 0) {
    return null;
  }
  return `${((done / total) * 100).toFixed(2)}%`;
}

/**
 * How much longer, in the coarsest unit that still says something.
 *
 * Deliberately vague above a minute. The estimate is drawn from the last
 * hundred releases and the rate is not steady - one whose files already carry
 * an MBID costs nothing and a searched one costs two rate-limited requests -
 * so a figure to the minute over two days would be precision the number does
 * not have.
 */
export function taskEstimate(etaMs: number | null): string | null {
  if (etaMs === null) {
    return null;
  }
  if (etaMs < MINUTE) {
    return "under a minute left";
  }
  const [size, unit] =
    etaMs < HOUR
      ? [Math.round(etaMs / MINUTE), "minute"]
      : etaMs < 2 * DAY
        ? [Math.round(etaMs / HOUR), "hour"]
        : [Math.round(etaMs / DAY), "day"];
  return `about ${size} ${size === 1 ? unit : `${unit}s`} left`;
}

/** The whole line: what is running, how far it has got, and how much longer. */
export function taskSummary(task: BackgroundTask): string {
  return [task.label, taskPercent(task.done, task.total), taskEstimate(task.etaMs)]
    .filter((part) => part !== null)
    .join(" · ");
}
