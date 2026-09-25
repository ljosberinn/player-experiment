import { useRef } from "react";
import { statsRecentPlays } from "../../../ipc";
import { useListenQuery } from "../useListenQuery";
import { usePagedRows } from "../usePagedRows";
import { StatsPanel } from "./StatsPanel";

/**
 * The play log, newest first.
 *
 * **Not a `SongTable`.** Its rows are plays rather than files: no selection, no
 * drag, no column config and no row menu, and the rule of three is nowhere
 * near met. It scrolls inside its own panel rather than with the view, because
 * it is the one thing here long enough to need a window over it.
 */
export function RecentPlays() {
  // `useVirtualizer` returns functions that change identity without the
  // instance doing so, and memoizing around them shows stale rows - the rule
  // `SongTable` states at length.
  "use no memo";

  const { query, deps } = useListenQuery();
  const scrollRef = useRef<HTMLDivElement>(null);

  const { rows, virtualizer } = usePagedRows(
    (offset, limit) => statsRecentPlays(query, offset, limit),
    deps,
    scrollRef,
  );
  const items = virtualizer.getVirtualItems();

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
                  <span className="plays-when">{when(play.startedAt)}</span>
                  <span className="plays-title">{play.title}</span>
                  <span className="plays-artist">{play.artist}</span>
                  {/* Said rather than implied: a play with no file behind it
                      is what the shopping list is made of. */}
                  {play.trackId === null && <span className="plays-unowned">not owned</span>}
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
  return `${at.toLocaleDateString()} ${at.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
