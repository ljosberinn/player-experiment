import { useRef } from "react";
import { statsNewArtists } from "../../../ipc";
import { useLibraryStore } from "../../library/store";
import { drill } from "../path";
import { useListenQuery } from "../useListenQuery";
import { usePagedRows } from "../usePagedRows";

/**
 * The artists the *New artists* chart counts, named: who was new in the range,
 * or the latest discoveries under all time.
 *
 * A row drills to the artist and keeps the range, so its plays - every one
 * since the first, which is what makes a discovery worth a second look - can
 * be more than the drilled view counts.
 */
export function NewArtistList() {
  // `useVirtualizer` returns functions that change identity without the
  // instance doing so, and memoizing around them shows stale rows - the rule
  // `SongTable` states at length.
  "use no memo";

  const { query, deps } = useListenQuery();
  const path = useLibraryStore((s) => s.statsPath);
  const showStatsPath = useLibraryStore((s) => s.showStatsPath);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { rows, virtualizer } = usePagedRows(
    (offset, limit) => statsNewArtists(query, offset, limit),
    deps,
    scrollRef,
  );
  const items = virtualizer.getVirtualItems();

  // The chart above already says the range is empty.
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="new-artists">
      <div className="new-artists-head" aria-hidden="true">
        <span className="new-artists-artist">Artist</span>
        <span className="new-artists-first">First heard</span>
        <span className="new-artists-plays">Plays since</span>
      </div>
      <div className="plays-scroll new-artists-scroll" ref={scrollRef}>
        <div className="plays-body" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {items.map((item) => {
            const row = rows[item.index];
            if (row === undefined) {
              return null;
            }
            const first = new Date(row.firstAt * 1000).toLocaleDateString();
            const plays = row.plays.toLocaleString();
            return (
              <button
                key={row.artist}
                type="button"
                className="plays-row new-artists-row"
                style={{ height: `${item.size}px`, transform: `translateY(${item.start}px)` }}
                // The header is hidden from a screen reader, so each row says
                // what its two figures are.
                aria-label={`${row.artist}, first heard ${first}, ${plays} plays since`}
                onClick={() => {
                  if (path !== null) {
                    void showStatsPath(drill(path, { kind: "artist", key: row.artist }));
                  }
                }}
              >
                <span className="new-artists-artist">{row.artist}</span>
                <span className="new-artists-first">{first}</span>
                <span className="new-artists-plays">{plays}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
