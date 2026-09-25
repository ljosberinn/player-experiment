import { describe, expect, it } from "vitest";
import type { Playlist } from "../../ipc";
import { albumIdentity } from "../library/browse";
import {
  activeFilters,
  DAY,
  DEFAULT_FILTERS,
  dateInputSeconds,
  dateInputValue,
  dayRange,
  earlierYears,
  libraryQuery,
  listenQuery,
  parseFilters,
  rangeFor,
  type StatsFilters,
  serializeFilters,
} from "./filters";

function filters(over: Partial<StatsFilters> = {}): StatsFilters {
  return { ...DEFAULT_FILTERS, ...over };
}

/** A Wednesday, mid-month, mid-year - none of the boundaries are the same day. */
const NOW = new Date(2026, 4, 13, 22, 40);

describe("parseFilters", () => {
  it("round-trips what it wrote", () => {
    const stored = filters({
      range: "custom",
      custom: { from: 100, to: 200 },
      owned: true,
      loved: false,
      scope: { kind: "playlist", playlistId: 3 },
      genre: "black metal",
    });

    expect(parseFilters(serializeFilters(stored))).toEqual(stored);
  });

  it("falls back on a value it does not recognise", () => {
    // Whatever the last version of the app stored: a filter bar that refuses
    // to open is worse than one that opens on the defaults.
    expect(parseFilters('{"range":"fortnight","scope":{"kind":"elsewhere"}}')).toEqual(
      DEFAULT_FILTERS,
    );
    expect(parseFilters("not json")).toEqual(DEFAULT_FILTERS);
    expect(parseFilters(null)).toEqual(DEFAULT_FILTERS);
  });

  it("drops a custom range that is empty or backwards", () => {
    expect(parseFilters('{"custom":{"from":200,"to":100}}').custom).toBeNull();
  });
});

describe("rangeFor", () => {
  it("is every play under all time", () => {
    expect(rangeFor(filters(), NOW)).toBeNull();
  });

  it("runs to the end of today, so a play an hour from now is inside it", () => {
    const month = rangeFor(filters({ range: "thisMonth" }), NOW);

    expect(month).toEqual({
      from: Math.floor(new Date(2026, 4, 1).getTime() / 1000),
      to: Math.floor(new Date(2026, 4, 14).getTime() / 1000),
    });
  });

  it("counts the last seven days inclusive of today", () => {
    expect(rangeFor(filters({ range: "days7" }), NOW)?.from).toBe(
      Math.floor(new Date(2026, 4, 7).getTime() / 1000),
    );
  });

  it("starts twelve months back on the same day of the month", () => {
    expect(rangeFor(filters({ range: "months12" }), NOW)?.from).toBe(
      Math.floor(new Date(2025, 4, 13).getTime() / 1000),
    );
  });

  it("is whatever was picked under custom, and nothing while it is half-typed", () => {
    expect(rangeFor(filters({ range: "custom", custom: { from: 1, to: 2 } }), NOW)).toEqual({
      from: 1,
      to: 2,
    });
    expect(rangeFor(filters({ range: "custom" }), NOW)).toBeNull();
  });
});

describe("dayRange", () => {
  it("runs from local midnight to the next", () => {
    expect(dayRange(2023, 8, 25)).toEqual({
      from: Math.floor(new Date(2023, 8, 25).getTime() / 1000),
      to: Math.floor(new Date(2023, 8, 26).getTime() / 1000),
    });
  });

  it("steps by the calendar, so a daylight-saving day is its own length", () => {
    // Late March and late October hold the change in most zones that have
    // one. It only bites in such a zone, which a UTC runner is not.
    for (const [month, day] of [
      [2, 26],
      [9, 29],
    ] as const) {
      const { from, to } = dayRange(2023, month, day);
      const start = new Date(from * 1000);
      const end = new Date(to * 1000);

      expect([start.getMonth(), start.getDate(), start.getHours()]).toEqual([month, day, 0]);
      expect([end.getMonth(), end.getDate(), end.getHours()]).toEqual([month, day + 1, 0]);
    }
  });
});

describe("earlierYears", () => {
  it("runs from last year back to the first year a play can be dated, newest first", () => {
    const years = earlierYears(new Date(2026, 8, 25, 14, 0));

    expect(years[0]).toBe(2025);
    expect(years.at(-1)).toBe(2002);
    expect(years).toHaveLength(24);
  });

  it("gives 29 February the leap years only", () => {
    expect(earlierYears(new Date(2024, 1, 29))).toEqual([2020, 2016, 2012, 2008, 2004]);
  });

  it("gives 28 February every year, rather than a leap day rolled back", () => {
    expect(earlierYears(new Date(2025, 1, 28))).toHaveLength(2024 - 2002 + 1);
  });
});

describe("the date inputs", () => {
  it("round-trip a local day", () => {
    const at = dateInputSeconds("2026-05-13");

    expect(at).not.toBeNull();
    expect(dateInputValue(at ?? 0)).toBe("2026-05-13");
  });

  it("read an empty field as nothing chosen", () => {
    expect(dateInputSeconds("")).toBeNull();
  });
});

describe("listenQuery", () => {
  it("carries the filters through", () => {
    const query = listenQuery(filters({ owned: true, loved: false }), null, NOW);

    expect(query.owned).toBe(true);
    expect(query.loved).toBe(false);
    expect(query.range).toBeNull();
  });

  it("narrows by the drill path, one field per kind", () => {
    const query = listenQuery(
      filters(),
      {
        tab: "listening",
        crumbs: [
          { kind: "genre", key: "black metal" },
          { kind: "artist", key: "Sral" },
        ],
      },
      NOW,
    );

    expect(query.genre).toBe("black metal");
    expect(query.artist).toBe("Sral");
    expect(query.album).toBeNull();
  });

  it("takes the last crumb of a kind, so a second artist replaces the first", () => {
    const query = listenQuery(
      filters(),
      {
        tab: "listening",
        crumbs: [
          { kind: "artist", key: "Sral" },
          { kind: "artist", key: "Panopticon" },
        ],
      },
      NOW,
    );

    expect(query.artist).toBe("Panopticon");
  });
});

describe("libraryQuery", () => {
  const view = { search: "bear", playlistId: 4, browse: null };

  it("ignores the view under the whole-library scope", () => {
    const query = libraryQuery(filters(), view);

    expect(query.search).toBeNull();
    expect(query.playlistId).toBeNull();
  });

  it("takes the view as it stands under the view scope", () => {
    const query = libraryQuery(filters({ scope: { kind: "view" } }), view);

    expect(query.search).toBe("bear");
    expect(query.playlistId).toBe(4);
  });

  it("scopes to one playlist and nothing else about the view", () => {
    const query = libraryQuery(filters({ scope: { kind: "playlist", playlistId: 9 } }), view);

    expect(query.playlistId).toBe(9);
    expect(query.search).toBeNull();
  });

  it("puts the genre facet in the genre slot, which is a subtree and not a tag", () => {
    const query = libraryQuery(filters({ genre: "black metal" }), view);

    expect(query.genre).toBe("black metal");
    expect(query.browse).toBeNull();
  });

  it("lets the deepest genre crumb beat the facet", () => {
    const query = libraryQuery(filters({ genre: "metal" }), view, {
      tab: "library",
      crumbs: [
        { kind: "genre", key: "black metal" },
        { kind: "genre", key: "atmospheric black metal" },
      ],
    });

    expect(query.genre).toBe("atmospheric black metal");
  });

  it("composes a genre with the view's drill-in rather than replacing it", () => {
    const album = { kind: "albums", id: albumIdentity("Shields", "Grizzly Bear") } as const;
    const query = libraryQuery(filters({ scope: { kind: "view" }, genre: "rock" }), {
      ...view,
      browse: album,
    });

    expect(query.genre).toBe("rock");
    expect(query.browse).toEqual(album);
  });
});

describe("activeFilters", () => {
  const mix: Playlist = {
    id: 9,
    name: "Mix",
    kind: "static",
    trackCount: 4,
    createdAt: 0,
    builtIn: null,
  };

  it("draws nothing while every facet is at its default", () => {
    expect(activeFilters(filters(), "listening", [])).toEqual([]);
    expect(activeFilters(filters(), "library", [mix])).toEqual([]);
  });

  it("reads the listening facets as a sentence, in the order the bar draws them", () => {
    const active = activeFilters(
      filters({ range: "months12", owned: true, loved: false }),
      "listening",
      [],
    );

    expect(active.map((filter) => filter.phrase)).toEqual([
      "last 12 months",
      "owned only",
      "not loved",
    ]);
  });

  it("says a custom range as the two days the fields show", () => {
    const from = dateInputSeconds("2024-03-01") ?? 0;
    const to = (dateInputSeconds("2024-03-31") ?? 0) + DAY;

    expect(
      activeFilters(filters({ range: "custom", custom: { from, to } }), "listening", []),
    ).toEqual([
      {
        facet: "range",
        phrase: `${new Date(from * 1000).toLocaleDateString()} – ${new Date(
          (to - DAY) * 1000,
        ).toLocaleDateString()}`,
        cleared: { range: "all", custom: null },
      },
    ]);
  });

  it("draws no range token before a custom range has its dates, because it narrows nothing", () => {
    const open = filters({ range: "custom", custom: null });

    expect(rangeFor(open, NOW)).toBeNull();
    expect(activeFilters(open, "listening", [])).toEqual([]);
  });

  it("names the playlist a scope is pointed at", () => {
    const active = activeFilters(
      filters({ scope: { kind: "playlist", playlistId: 9 } }),
      "library",
      [mix],
    );

    expect(active[0]?.phrase).toBe("Mix");
  });

  it("keeps each tab to the facets its own query reads", () => {
    const both = filters({ owned: true, genre: "black metal" });

    expect(activeFilters(both, "listening", []).map((filter) => filter.facet)).toEqual(["owned"]);
    expect(activeFilters(both, "library", []).map((filter) => filter.facet)).toEqual(["genre"]);
  });

  it("draws owned and loved on On this day, and no range, however one is set", () => {
    const set = filters({
      range: "custom",
      custom: { from: 100, to: 200 },
      owned: false,
      loved: true,
      scope: { kind: "view" },
      genre: "black metal",
    });

    expect(activeFilters(set, "onThisDay", []).map((filter) => filter.facet)).toEqual([
      "owned",
      "loved",
    ]);
    expect(activeFilters(filters({ range: "days7" }), "onThisDay", [])).toEqual([]);
  });

  it("clears a facet back to its default", () => {
    const active = activeFilters(filters({ scope: { kind: "view" } }), "library", []);

    expect({ ...filters({ scope: { kind: "view" } }), ...active[0]?.cleared }).toEqual(
      DEFAULT_FILTERS,
    );
  });
});
