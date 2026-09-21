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

/**
 * The readout, in the two lines section 05 draws it on.
 *
 * What is running and how far it has got are one statement and share a line;
 * how much longer is a second, and was a third clause of the first until the
 * sheet split them.
 *
 * A task with no total yet is at nought rather than at nothing: the rail is
 * what says a pass has started, and a started pass with no denominator is
 * still one that has not got anywhere.
 */
export function taskLines(task: BackgroundTask): {
  headline: string;
  estimate: string | null;
  ratio: number;
} {
  const percent = taskPercent(task.done, task.total);

  return {
    headline: percent === null ? task.label : `${task.label} · ${percent}`,
    estimate: taskEstimate(task.etaMs),
    ratio: task.total === 0 ? 0 : task.done / task.total,
  };
}
