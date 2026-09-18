import { type DependencyList, useEffect, useState } from "react";
import { report } from "../shell/statusStore";

/**
 * What every Statistics panel does with its aggregate.
 *
 * Fetch on mount and whenever the filters or the drill path move, ignore an
 * answer that arrives after the question changed, and report a failure rather
 * than leaving a skeleton up forever. Nine panels would otherwise write the
 * same effect, and the one of them that forgot the cancel would redraw with a
 * stale range's numbers whenever two ranges were picked in quick succession.
 *
 * `loading` is separate from `data === null` because they are different
 * states: a panel that has never fetched and a panel refetching under a new
 * range both have data from nowhere, and only the first is a skeleton.
 */
export interface PanelQuery<T> {
  readonly data: T | null;
  readonly loading: boolean;
}

export function usePanelQuery<T>(run: () => Promise<T>, deps: DependencyList): PanelQuery<T> {
  const [state, setState] = useState<PanelQuery<T>>({ data: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    // The previous answer is kept while the new one is in flight: replacing it
    // with a skeleton on every range change makes the whole view flash, and
    // what was drawn is the answer to the question before last rather than to
    // no question at all.
    setState((previous) => ({ data: previous.data, loading: true }));

    run()
      .then((data) => {
        if (!cancelled) {
          setState({ data, loading: false });
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setState({ data: null, loading: false });
          report(cause);
        }
      });

    return () => {
      cancelled = true;
    };
    // `run` closes over the deps the caller lists, so listing it here too
    // would refetch on every render of the panel that owns it.
    // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's deps are the query
  }, deps);

  return state;
}
