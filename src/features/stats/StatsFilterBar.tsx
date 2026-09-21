import { useEffect, useState } from "react";
import { Select } from "../../components/primitives/Select";
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
 * The selects were native, by phase 24's stop clause - a native select in a
 * webview opens a real OS popup. Phase 111 lifted it: an OS popup draws in the
 * OS's colours, and a bar of them beside drawn controls on a light ground the
 * OS knows nothing about was the wrong kind of native.
 *
 * Each one is named by `label` rather than by a `<label>` around it, and the
 * caption beside it is a plain `<span>`. A `<label>` wrapping a drawn select
 * would be labelling a `<button>` by its own text content - the caption and
 * the chosen value read out as one string - and clicking the caption would
 * not open anything, because a wrapping label forwards its click to form
 * controls and a button is not one. The date fields below keep theirs.
 */
export function StatsFilterBar({ tab }: { tab: StatsTab }) {
  const filters = useStatsStore((s) => s.filters);
  const setFilters = useStatsStore((s) => s.setFilters);

  return (
    <div className="stats-filters">
      {tab === "listening" ? (
        <>
          <span className="stats-filter">
            Range
            <Select
              label="Range"
              value={filters.range}
              options={(Object.keys(RANGE_TITLES) as RangeId[]).map((id) => ({
                value: id,
                label: RANGE_TITLES[id],
              }))}
              onChange={(range) => setFilters({ range })}
            />
          </span>

          {filters.range === "custom" ? <CustomRange /> : null}

          {/* Tri-state, and a checkbox has two: "either" is the default and the
              most common answer, so it has to be reachable. */}
          <span className="stats-filter">
            Owned
            <Select
              label="Owned"
              value={triValue(filters.owned)}
              options={[
                { value: "either", label: "Either" },
                { value: "yes", label: "In the library" },
                { value: "no", label: "Not in the library" },
              ]}
              onChange={(value) => setFilters({ owned: triState(value) })}
            />
          </span>

          <span className="stats-filter">
            Loved
            <Select
              label="Loved"
              value={triValue(filters.loved)}
              options={[
                { value: "either", label: "Either" },
                { value: "yes", label: "Loved" },
                { value: "no", label: "Not loved" },
              ]}
              onChange={(value) => setFilters({ loved: triState(value) })}
            />
          </span>
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
    <span className="stats-filter">
      Scope
      <Select
        label="Scope"
        value={scope.kind === "playlist" ? `playlist:${scope.playlistId}` : scope.kind}
        options={[
          { value: "library", label: "Whole library" },
          { value: "view", label: "Current view" },
          ...playlists.map((playlist) => ({
            value: `playlist:${playlist.id}`,
            label: playlist.name,
          })),
        ]}
        onChange={(value) => setFilters({ scope: parseScopeValue(value) })}
      />
    </span>
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
        genre: null,
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
    <span className="stats-filter">
      Genre
      <Select
        label="Genre"
        value={genre ?? ""}
        options={[
          { value: "", label: "Every genre" },
          // The untagged group is `key: null`, which is a filter this bar has
          // no way to express - "no genre" is not one genre.
          ...genres
            .map((group) => group.key)
            .filter((key) => key !== null)
            .map((key) => ({ value: key, label: key })),
        ]}
        onChange={(value) => setFilters({ genre: value === "" ? null : value })}
      />
    </span>
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
