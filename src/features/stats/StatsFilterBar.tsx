import { useEffect, useState } from "react";
import { type BrowseGroup, browseGroups } from "../../ipc";
import { usePlaylistsStore } from "../playlists/store";
import {
  dateInputSeconds,
  dateInputValue,
  RANGE_TITLES,
  type RangeId,
  type StatsScope,
} from "./filters";
import type { StatsTab } from "./path";
import { useStatsStore } from "./store";

/**
 * What the open tab is filtered by.
 *
 * The contents follow the tab because the subjects do: Listening is a span of
 * time over plays, Library is a slice of the files on disk. One bar rather than
 * two, because the row itself - its place, its height, its separator - is the
 * same row either way.
 *
 * The three selects are native, by phase 24's stop clause: a native select in a
 * webview opens a real OS popup, which is closer to native than any listbox.
 */
export function StatsFilterBar({ tab }: { tab: StatsTab }) {
  const filters = useStatsStore((s) => s.filters);
  const setFilters = useStatsStore((s) => s.setFilters);

  return (
    <div className="stats-filters">
      {tab === "listening" ? (
        <>
          <label className="stats-filter">
            Range
            <select
              value={filters.range}
              onChange={(event) => setFilters({ range: event.target.value as RangeId })}
            >
              {(Object.keys(RANGE_TITLES) as RangeId[]).map((id) => (
                <option key={id} value={id}>
                  {RANGE_TITLES[id]}
                </option>
              ))}
            </select>
          </label>

          {filters.range === "custom" ? <CustomRange /> : null}

          {/* Tri-state, and a checkbox has two: "either" is the default and the
              most common answer, so it has to be reachable. */}
          <label className="stats-filter">
            Owned
            <select
              value={triValue(filters.owned)}
              onChange={(event) => setFilters({ owned: triState(event.target.value) })}
            >
              <option value="either">Either</option>
              <option value="yes">In the library</option>
              <option value="no">Not in the library</option>
            </select>
          </label>

          <label className="stats-filter">
            Loved
            <select
              value={triValue(filters.loved)}
              onChange={(event) => setFilters({ loved: triState(event.target.value) })}
            >
              <option value="either">Either</option>
              <option value="yes">Loved</option>
              <option value="no">Not loved</option>
            </select>
          </label>
        </>
      ) : (
        <>
          <ScopeFilter />
          <GenreFilter />
        </>
      )}
    </div>
  );
}

/** The two bounds behind `range: "custom"`, in local time. */
function CustomRange() {
  const custom = useStatsStore((s) => s.filters.custom);
  const setFilters = useStatsStore((s) => s.setFilters);

  const change = (edge: "from" | "to", value: string) => {
    const at = dateInputSeconds(value);
    if (at === null) {
      return;
    }
    // A day chosen as the end means the end of that day, or picking one day
    // twice would be an empty range rather than that day.
    const next = { ...(custom ?? { from: at, to: at }), [edge]: edge === "to" ? at + DAY : at };
    if (next.to > next.from) {
      setFilters({ custom: next });
    }
  };

  return (
    <>
      <label className="stats-filter">
        From
        <input
          type="date"
          value={custom === null ? "" : dateInputValue(custom.from)}
          onChange={(event) => change("from", event.target.value)}
        />
      </label>
      <label className="stats-filter">
        To
        <input
          type="date"
          value={custom === null ? "" : dateInputValue(custom.to - DAY)}
          onChange={(event) => change("to", event.target.value)}
        />
      </label>
    </>
  );
}

const DAY = 86_400;

function ScopeFilter() {
  const scope = useStatsStore((s) => s.filters.scope);
  const setFilters = useStatsStore((s) => s.setFilters);
  const playlists = usePlaylistsStore((s) => s.playlists);

  return (
    <label className="stats-filter">
      Scope
      <select
        value={scope.kind === "playlist" ? `playlist:${scope.playlistId}` : scope.kind}
        onChange={(event) => setFilters({ scope: parseScopeValue(event.target.value) })}
      >
        <option value="library">Whole library</option>
        <option value="view">Current view</option>
        {playlists.map((playlist) => (
          <option key={playlist.id} value={`playlist:${playlist.id}`}>
            {playlist.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * One genre, from the same list the Genres view browses.
 *
 * Asked for once, when the bar opens on this tab: the list changes only when
 * the library does, and a select that re-queried on every filter change would
 * be a query per click on an unrelated control.
 */
function GenreFilter() {
  const genre = useStatsStore((s) => s.filters.genre);
  const setFilters = useStatsStore((s) => s.setFilters);
  const [genres, setGenres] = useState<BrowseGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    void browseGroups(
      {
        search: null,
        playlistId: null,
        browse: null,
        sortBy: "artist",
        direction: "asc",
        offset: 0,
        limit: 0,
      },
      "genres",
    )
      .then((loaded) => {
        if (!cancelled) {
          setGenres(loaded);
        }
      })
      .catch(() => {
        // An empty list leaves the facet at "Every genre", which is the state
        // it is in anyway. Not worth a banner over the tiles.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <label className="stats-filter">
      Genre
      <select
        value={genre ?? ""}
        onChange={(event) =>
          setFilters({ genre: event.target.value === "" ? null : event.target.value })
        }
      >
        <option value="">Every genre</option>
        {genres.map((group) =>
          // The untagged group is `key: null`, which is a filter this bar has
          // no way to express - "no genre" is not one genre.
          group.key === null ? null : (
            <option key={group.key} value={group.key}>
              {group.key}
            </option>
          ),
        )}
      </select>
    </label>
  );
}

function parseScopeValue(value: string): StatsScope {
  if (value.startsWith("playlist:")) {
    return { kind: "playlist", playlistId: Number(value.slice("playlist:".length)) };
  }
  return value === "view" ? { kind: "view" } : { kind: "library" };
}

function triValue(value: boolean | null): string {
  return value === null ? "either" : value ? "yes" : "no";
}

function triState(value: string): boolean | null {
  return value === "either" ? null : value === "yes";
}
