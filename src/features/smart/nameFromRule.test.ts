import { describe, expect, it } from "vitest";
import type { FilterGroup } from "../../ipc";
import { isUninformative, suggestedName } from "./nameFromRule";

const artistIsRome: FilterGroup = {
  combinator: "all",
  children: [{ type: "rule", field: "artist", op: "is", value: { kind: "text", text: "Rome" } }],
};

const artistIsEmpty: FilterGroup = {
  combinator: "all",
  children: [{ type: "rule", field: "artist", op: "is", value: { kind: "text", text: "" } }],
};

const yearIs2012: FilterGroup = {
  combinator: "all",
  children: [{ type: "rule", field: "year", op: "is", value: { kind: "number", number: 2012 } }],
};

const yearBetween: FilterGroup = {
  combinator: "all",
  children: [
    { type: "rule", field: "year", op: "between", value: { kind: "range", from: 2000, to: 2010 } },
  ],
};

const commentIsEmptyOp: FilterGroup = {
  combinator: "all",
  children: [{ type: "rule", field: "comment", op: "isEmpty", value: { kind: "none" } }],
};

const twoRules: FilterGroup = {
  combinator: "all",
  children: [
    { type: "rule", field: "artist", op: "is", value: { kind: "text", text: "Rome" } },
    { type: "rule", field: "album", op: "is", value: { kind: "text", text: "Berlin" } },
  ],
};

const nestedGroup: FilterGroup = {
  combinator: "all",
  children: [
    {
      type: "group",
      combinator: "any",
      children: [
        { type: "rule", field: "artist", op: "is", value: { kind: "text", text: "Rome" } },
      ],
    },
  ],
};

describe("suggestedName", () => {
  it("names a single text rule after its value", () => {
    expect(suggestedName(artistIsRome)).toBe("Rome");
  });

  it("names a single number rule after its value", () => {
    expect(suggestedName(yearIs2012)).toBe("2012");
  });

  it("offers nothing for an empty value", () => {
    expect(suggestedName(artistIsEmpty)).toBeNull();
  });

  it("offers nothing for a range - no single value reads as the name", () => {
    expect(suggestedName(yearBetween)).toBeNull();
  });

  it("offers nothing for a valueless operator", () => {
    expect(suggestedName(commentIsEmptyOp)).toBeNull();
  });

  it("offers nothing for two rules", () => {
    expect(suggestedName(twoRules)).toBeNull();
  });

  it("offers nothing for a nested group, even holding one rule", () => {
    expect(suggestedName(nestedGroup)).toBeNull();
  });

  it("offers nothing for an empty filter", () => {
    expect(suggestedName({ combinator: "all", children: [] })).toBeNull();
  });
});

describe("isUninformative", () => {
  const defaultName = "New Smart Playlist";

  it("is true for the default name, whatever the filter", () => {
    expect(isUninformative(defaultName, twoRules, defaultName)).toBe(true);
    expect(isUninformative(defaultName, artistIsRome, defaultName)).toBe(true);
  });

  it("is true for a name that restates the rule the editor already shows", () => {
    expect(isUninformative("Artist is Rome", artistIsRome, defaultName)).toBe(true);
  });

  it("is false for a name the user actually chose", () => {
    expect(isUninformative("Touring Bands", artistIsRome, defaultName)).toBe(false);
  });

  it("is false for a restatement of a different rule than the one shown", () => {
    expect(isUninformative("Artist is Rome", twoRules, defaultName)).toBe(false);
  });
});
