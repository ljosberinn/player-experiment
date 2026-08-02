import { describe, expect, it } from "vitest";
import type { FilterGroup, FilterNode, FilterRule } from "../../ipc";
import {
  addNode,
  countRules,
  emptyFilter,
  groupAt,
  kindOf,
  labelOf,
  newGroup,
  newRule,
  opsFor,
  removeNode,
  setCombinator,
  setRule,
  valueFor,
} from "./filterTree";

function rule(overrides: Partial<FilterRule> = {}): FilterNode {
  return { type: "rule", ...newRule(), ...overrides };
}

function group(children: FilterNode[], combinator: FilterGroup["combinator"] = "all"): FilterNode {
  return { type: "group", combinator, children };
}

describe("field metadata", () => {
  it("classifies every field it offers", () => {
    expect(kindOf("artist")).toBe("text");
    expect(kindOf("year")).toBe("number");
    expect(kindOf("addedAt")).toBe("timestamp");
  });

  it("offers each kind only the operators that fit it", () => {
    // "in the last N days" on a title, or "contains" on a year, are exactly
    // what the backend refuses - so the editor must not offer them.
    expect(opsFor("artist")).toContain("contains");
    expect(opsFor("artist")).not.toContain("inLast");
    expect(opsFor("year")).not.toContain("contains");
    expect(opsFor("addedAt")).toContain("inLast");
  });

  it("falls back rather than crashing on a field it does not know", () => {
    // A filter stored by a later build, opened by this one.
    const unknown = "somethingNew" as never;
    expect(kindOf(unknown)).toBe("text");
    expect(labelOf(unknown)).toBe("somethingNew");
  });
});

describe("valueFor", () => {
  it("gives a valueless operator no value at all", () => {
    expect(valueFor("artist", "isEmpty")).toEqual({ kind: "none" });
    expect(valueFor("year", "isNotEmpty")).toEqual({ kind: "none" });
  });

  it("matches the value to the field's kind", () => {
    expect(valueFor("artist", "is")).toEqual({ kind: "text", text: "" });
    expect(valueFor("year", "is")).toEqual({ kind: "number", number: 0 });
    expect(valueFor("year", "between")).toEqual({ kind: "range", from: 0, to: 0 });
  });

  it("carries what was already typed across an operator change", () => {
    const typed = { kind: "text", text: "Grizzly" } as const;

    // Switching "is" to "contains" should not empty the box.
    expect(valueFor("artist", "contains", typed)).toEqual(typed);
  });

  it("carries a number into a range rather than resetting it", () => {
    const typed = { kind: "number", number: 2012 } as const;

    expect(valueFor("year", "between", typed)).toEqual({ kind: "range", from: 2012, to: 2012 });
    expect(valueFor("year", "greaterThan", { kind: "range", from: 2012, to: 2017 })).toEqual({
      kind: "number",
      number: 2012,
    });
  });

  it("drops a value that cannot survive the change", () => {
    // Text on a numeric field is exactly what the backend refuses.
    expect(valueFor("year", "is", { kind: "text", text: "Grizzly" })).toEqual({
      kind: "number",
      number: 0,
    });
  });
});

describe("newRule", () => {
  it("is valid the moment it is created", () => {
    const created = newRule("addedAt");

    expect(opsFor("addedAt")).toContain(created.op);
    expect(created.value).toEqual(valueFor("addedAt", created.op));
  });
});

describe("tree editing", () => {
  const tree: FilterGroup = {
    combinator: "all",
    children: [
      rule({ field: "artist" }),
      group([rule({ field: "year" }), rule({ field: "genre" })], "any"),
    ],
  };

  it("finds a nested group by its path", () => {
    expect(groupAt(tree, [1])?.combinator).toBe("any");
    expect(groupAt(tree, [])).toBe(tree);
  });

  it("reports a path that does not lead to a group", () => {
    expect(groupAt(tree, [0])).toBeNull();
    expect(groupAt(tree, [9])).toBeNull();
  });

  it("adds to the group the path names, not to the root", () => {
    const next = addNode(tree, [1], rule({ field: "album" }));

    expect(groupAt(next, [1])?.children).toHaveLength(3);
    expect(next.children).toHaveLength(2);
  });

  it("removes a nested node without disturbing its siblings", () => {
    const next = removeNode(tree, [1, 0]);

    expect(groupAt(next, [1])?.children).toHaveLength(1);
    expect(groupAt(next, [1])?.children[0]).toMatchObject({ field: "genre" });
  });

  it("leaves the root alone when asked to remove it", () => {
    // The editor never offers this, but a click handler must not throw.
    expect(removeNode(tree, [])).toBe(tree);
  });

  it("changes one group's combinator and no other's", () => {
    const next = setCombinator(tree, [1], "all");

    expect(groupAt(next, [1])?.combinator).toBe("all");
    expect(next.combinator).toBe("all");
    expect(setCombinator(tree, [], "any").combinator).toBe("any");
  });

  it("replaces a nested rule in place", () => {
    const replaced: FilterRule = {
      field: "playCount",
      op: "greaterThan",
      value: { kind: "number", number: 5 },
    };

    const next = setRule(tree, [1, 1], replaced);

    expect(groupAt(next, [1])?.children[1]).toEqual({ type: "rule", ...replaced });
    expect(groupAt(next, [1])?.children[0]).toMatchObject({ field: "year" });
  });

  it("never mutates the tree it was given", () => {
    const before = JSON.stringify(tree);

    addNode(tree, [1], rule());
    removeNode(tree, [0]);
    setCombinator(tree, [1], "all");
    setRule(tree, [0], newRule("album"));

    // The editor holds the root in state; a mutation would not re-render.
    expect(JSON.stringify(tree)).toBe(before);
  });

  it("returns a new root every time, so React sees the change", () => {
    expect(addNode(tree, [], rule())).not.toBe(tree);
    expect(setCombinator(tree, [], "any")).not.toBe(tree);
  });

  it("counts rules through nesting, and groups are not rules", () => {
    expect(countRules(tree)).toBe(3);
    expect(countRules(emptyFilter)).toBe(0);
    expect(countRules(newGroup() as FilterGroup)).toBe(1);
  });
});
