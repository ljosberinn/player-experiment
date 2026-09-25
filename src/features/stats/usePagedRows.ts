import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { type RefObject, useEffect, useRef, useState } from "react";
import { report } from "../shell/statusStore";

/** How many rows one fetch brings back. */
const PAGE = 100;
/** Rows before the end at which the next page is asked for. */
const LOOKAHEAD = 20;
const ROW_HEIGHT = 31;
const OVERSCAN = 8;

export interface PagedRows<T> {
  readonly rows: readonly T[];
  readonly virtualizer: Virtualizer<HTMLDivElement, Element>;
}

/**
 * A list a panel pages in as it is scrolled, windowed over `scrollRef`.
 *
 * Paged rather than counted first: the count would be a second scan of the
 * log to learn a number the panel would only use to size a scrollbar.
 *
 * `fetchPage` closes over the query that `deps` names, so a change to `deps`
 * starts the list again from the top.
 */
export function usePagedRows<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  deps: readonly unknown[],
  scrollRef: RefObject<HTMLDivElement | null>,
): PagedRows<T> {
  // `useVirtualizer` returns functions that change identity without the
  // instance doing so, and memoizing around them shows stale rows - the rule
  // `SongTable` states at length.
  "use no memo";

  const [rows, setRows] = useState<T[]>([]);
  const [done, setDone] = useState(false);
  // A ref rather than state: it guards the fetch that the render after it
  // would otherwise start again, and a re-render is not what it is for.
  const loading = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `fetchPage` is rebuilt every render out of exactly `deps`
  useEffect(() => {
    let cancelled = false;
    loading.current = true;
    setRows([]);
    setDone(false);
    scrollRef.current?.scrollTo({ top: 0 });

    fetchPage(0, PAGE)
      .then((page) => {
        if (!cancelled) {
          setRows(page);
          setDone(page.length < PAGE);
          loading.current = false;
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          loading.current = false;
          report(cause);
        }
      });

    return () => {
      cancelled = true;
    };
    // Spread rather than passed whole: the rule refuses to reason about a
    // dependency list that is not an array literal.
  }, [...deps]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const lastIndex = virtualizer.getVirtualItems().at(-1)?.index;

  // The index alone: a virtual item is a new object on every scroll frame, and
  // depending on it would ask for the next page sixty times a second.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fetchPage` is rebuilt every render out of exactly `deps`
  useEffect(() => {
    if (done || loading.current || lastIndex === undefined) {
      return;
    }
    if (lastIndex < rows.length - LOOKAHEAD) {
      return;
    }
    loading.current = true;
    const offset = rows.length;
    fetchPage(offset, PAGE)
      .then((page) => {
        loading.current = false;
        // Appended against the length the fetch started from, so a filter
        // change that emptied the list mid-flight does not get this page
        // stapled onto the new one.
        setRows((current) => (current.length === offset ? [...current, ...page] : current));
        if (page.length < PAGE) {
          setDone(true);
        }
      })
      .catch((cause: unknown) => {
        loading.current = false;
        report(cause);
      });
  }, [lastIndex, rows.length, done, ...deps]);

  return { rows, virtualizer };
}
