import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import { type Play, statsRecentPlays } from "../../../ipc";
import { report } from "../../shell/statusStore";
import { useListenQuery } from "../useListenQuery";
import { PlayRowContent, playTime } from "./PlayRowContent";
import { StatsPanel } from "./StatsPanel";

/** How many plays one fetch brings back. */
const PAGE = 100;
/** Rows before the end at which the next page is asked for. */
const LOOKAHEAD = 20;
const ROW_HEIGHT = 31;
const OVERSCAN = 8;

/**
 * The play log, newest first.
 *
 * **Not a `SongTable`.** Its rows are plays rather than files: no selection, no
 * drag, no column config and no row menu, and the rule of three is nowhere
 * near met. It scrolls inside its own panel rather than with the view, because
 * it is the one thing here long enough to need a window over it.
 *
 * Paged as it is scrolled rather than counted first. The count is available -
 * `listen_totals` has it - but asking for it would be a second scan of the log
 * to learn a number this panel would only use to size a scrollbar.
 */
export function RecentPlays() {
  // `useVirtualizer` returns functions that change identity without the
  // instance doing so, and memoizing around them shows stale rows - the rule
  // `SongTable` states at length.
  "use no memo";

  const { query, deps } = useListenQuery();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<Play[]>([]);
  const [done, setDone] = useState(false);
  // A ref rather than state: it guards the fetch that the render after it
  // would otherwise start again, and a re-render is not what it is for.
  const loading = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `query` is rebuilt every render out of exactly `deps`
  useEffect(() => {
    let cancelled = false;
    loading.current = true;
    setRows([]);
    setDone(false);
    scrollRef.current?.scrollTo({ top: 0 });

    statsRecentPlays(query, 0, PAGE)
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

  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index;

  // The index alone: a virtual item is a new object on every scroll frame, and
  // depending on it would ask for the next page sixty times a second.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `query` is rebuilt every render out of exactly `deps`
  useEffect(() => {
    if (done || loading.current || lastIndex === undefined) {
      return;
    }
    if (lastIndex < rows.length - LOOKAHEAD) {
      return;
    }
    loading.current = true;
    const offset = rows.length;
    statsRecentPlays(query, offset, PAGE)
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

  return (
    <StatsPanel title="Recent plays">
      {rows.length === 0 ? (
        <p className="empty-state">Nothing in this range.</p>
      ) : (
        <div className="plays-scroll" ref={scrollRef}>
          <div className="plays-body" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {items.map((item) => {
              const play = rows[item.index];
              if (play === undefined) {
                return null;
              }
              return (
                <div
                  key={play.id}
                  className="plays-row"
                  style={{ height: `${item.size}px`, transform: `translateY(${item.start}px)` }}
                >
                  <PlayRowContent play={play} when={when(play.startedAt)} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </StatsPanel>
  );
}

function when(unixSeconds: number | null): string {
  if (unixSeconds === null) {
    return "Undated";
  }
  const at = new Date(unixSeconds * 1000);
  return `${at.toLocaleDateString()} ${playTime(at)}`;
}
