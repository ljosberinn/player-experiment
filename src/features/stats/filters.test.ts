import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  dateInputSeconds,
  dateInputValue,
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

  it("puts the genre facet through browse, which is where genre filtering is", () => {
    const query = libraryQuery(filters({ genre: "black metal" }), view);

    expect(query.browse).toEqual({ kind: "genres", key: "black metal", secondary: null });
  });
});
