/**
 * Runs `fn` once `waitMs` have passed without another call.
 *
 * Used for the search box: a keystroke must not cost a round trip to SQLite,
 * but the box itself has to stay responsive, so the input value is state and
 * only the *query* is debounced.
 *
 * `cancel` exists so a caller that wants to act immediately - clearing the box,
 * pressing Enter - can drop a pending call rather than have it fire afterwards
 * and undo the immediate one.
 */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel: () => void;
  /** Runs a pending call now, if there is one. */
  flush: () => void;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;

  const debounced = (...args: A) => {
    pending = args;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      const args = pending;
      pending = undefined;
      if (args) {
        fn(...args);
      }
    }, waitMs);
  };

  debounced.cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    pending = undefined;
  };

  debounced.flush = () => {
    if (timer === undefined) {
      return;
    }
    clearTimeout(timer);
    timer = undefined;
    const args = pending;
    pending = undefined;
    if (args) {
      fn(...args);
    }
  };

  return debounced;
}
