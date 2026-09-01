import type {
  FilterField,
  FilterFieldKind,
  FilterGroup,
  FilterNode,
  FilterOp,
  FilterRule,
  FilterValue,
  SmartOrder,
  SortField,
  TagValueField,
} from "../../ipc";
// Straight from the generated table rather than through `../../ipc`, whose
// index pulls in `invoke`: this module is pure, and nothing here should need a
// Tauri runtime to be imported.
import { FILTER_FIELD_KINDS } from "../../ipc/bindings/filterOps.generated";

/**
 * Editing operations on a filter tree.
 *
 * Pure and separate from the editor component: a nested and/or tree is where
 * the bugs live, not in the inputs that render it.
 *
 * What a field holds comes from the backend (`FILTER_FIELD_KINDS`), because
 * that is a fact about the schema and not a decision. What the editor *offers*
 * is decided here, and `filterTree.test.ts` holds it to the backend's accepted
 * set - the backend compiles every filter before storing it, so offering a
 * combination it refuses is annoying, never unsafe.
 */

export interface FieldDef {
  id: FilterField;
  label: string;
}

/**
 * The fields the editor offers, in the order it offers them.
 *
 * Labels and order are UI decisions, which is why this list is written by hand
 * rather than generated. Its completeness is not a decision: the test asserts
 * every field the backend knows appears here, so a column added to the filter
 * enum cannot quietly go missing from the dropdown.
 */
export const FIELDS: FieldDef[] = [
  { id: "title", label: "Name" },
  { id: "artist", label: "Artist" },
  { id: "album", label: "Album" },
  { id: "albumArtist", label: "Album Artist" },
  { id: "genre", label: "Genre" },
  { id: "comment", label: "Comment" },
  { id: "path", label: "Location" },
  { id: "year", label: "Year" },
  { id: "trackNo", label: "Track Number" },
  { id: "discNo", label: "Disc Number" },
  { id: "durationMs", label: "Time (ms)" },
  { id: "bitrate", label: "Bit Rate" },
  { id: "sampleRate", label: "Sample Rate" },
  { id: "playCount", label: "Plays" },
  { id: "addedAt", label: "Date Added" },
  { id: "lastPlayedAt", label: "Last Played" },
];

/**
 * Which vocabulary of existing values a rule on `field` should suggest.
 *
 * "artist is ___" wants exactly what the tag editor's Artist field wants, and
 * typing a band name by hand into a filter is how a smart playlist ends up
 * matching nothing at all. The fields with no shared vocabulary - title,
 * comment, location, every count and every date - offer none.
 *
 * Year is absent even though it has a vocabulary: its editor is a number input,
 * and trading the spinner and the numeric keyboard for a dropdown of four-digit
 * strings is a poor deal. The tag editor, where Year is free text already,
 * still suggests it.
 */
export function vocabularyFor(field: FilterField): TagValueField | null {
  switch (field) {
    case "artist":
      return "artist";
    case "album":
      return "album";
    case "albumArtist":
      return "albumArtist";
    case "genre":
      return "genre";
    default:
      return null;
  }
}

export const OP_LABELS: Record<FilterOp, string> = {
  is: "is",
  isNot: "is not",
  contains: "contains",
  doesNotContain: "does not contain",
  startsWith: "starts with",
  endsWith: "ends with",
  greaterThan: "is greater than",
  lessThan: "is less than",
  between: "is between",
  inLast: "is in the last",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
};

/** Operators that carry no value, so the editor renders no input for them. */
const VALUELESS: FilterOp[] = ["isEmpty", "isNotEmpty"];

/**
 * The operators the editor offers per kind.
 *
 * A deliberate subset of `ACCEPTED_FILTER_OPS`, which is why it is written out
 * here rather than generated: timestamp omits "is" and "is not" on purpose,
 * because the backend compares against an exact unix second and nobody wants
 * to be offered a date match that lands on one. Do not "fix" that by adding
 * them - the test only checks this is a subset, so narrowing further is
 * allowed and widening past what the backend takes is not.
 */
const OPS_BY_KIND: Record<FilterFieldKind, FilterOp[]> = {
  text: [
    "is",
    "isNot",
    "contains",
    "doesNotContain",
    "startsWith",
    "endsWith",
    "isEmpty",
    "isNotEmpty",
  ],
  number: ["is", "isNot", "greaterThan", "lessThan", "between", "isEmpty", "isNotEmpty"],
  timestamp: ["inLast", "greaterThan", "lessThan", "between", "isEmpty", "isNotEmpty"],
};

/**
 * What kind of value a field holds.
 *
 * Falls back to text for a field this build does not know, which is a filter
 * stored by a later one: an editor that renders the wrong input beats an
 * editor that throws.
 */
export function kindOf(field: FilterField): FilterFieldKind {
  return FILTER_FIELD_KINDS[field] ?? "text";
}

export function labelOf(field: FilterField): string {
  return FIELDS.find((definition) => definition.id === field)?.label ?? field;
}

export function opsFor(field: FilterField): FilterOp[] {
  return OPS_BY_KIND[kindOf(field)];
}

/**
 * The value a rule should carry given its field and operator.
 *
 * Called whenever either changes, so switching "Artist contains rock" to
 * "Year is" cannot leave a text value on a numeric field - which the backend
 * would refuse, correctly but unhelpfully, at save time.
 *
 * What the user already typed is carried across where it survives the change:
 * retyping a year because you switched from "is" to "is greater than" is the
 * kind of small insult that makes an editor tiring.
 */
export function valueFor(field: FilterField, op: FilterOp, previous?: FilterValue): FilterValue {
  if (VALUELESS.includes(op)) {
    return { kind: "none" };
  }
  if (op === "between") {
    const from = numberIn(previous) ?? 0;
    return previous?.kind === "range" ? previous : { kind: "range", from, to: from };
  }
  if (kindOf(field) === "text") {
    return { kind: "text", text: previous?.kind === "text" ? previous.text : "" };
  }
  return { kind: "number", number: numberIn(previous) ?? 0 };
}

function numberIn(value: FilterValue | undefined): number | null {
  if (value?.kind === "number") {
    return value.number;
  }
  if (value?.kind === "range") {
    return value.from;
  }
  return null;
}

/** A fresh rule, for the "+" that adds one. */
export function newRule(field: FilterField = "artist"): FilterRule {
  const op = opsFor(field)[0] ?? "is";
  return { field, op, value: valueFor(field, op) };
}

export function newGroup(): FilterGroup {
  // A group with one rule in it, rather than an empty one: an empty group
  // matches everything, which is a confusing thing to have just added.
  return { combinator: "any", children: [{ type: "rule", ...newRule() }] };
}

export const emptyFilter: FilterGroup = { combinator: "all", children: [] };

/**
 * Where a node sits in the tree: one child index per level.
 *
 * An empty path is the root group itself, which is why the root cannot be
 * removed - there is no parent to remove it from.
 */
export type Path = readonly number[];

function isGroup(node: FilterNode): node is { type: "group" } & FilterGroup {
  return node.type === "group";
}

/** The group at `path`, or null when the path does not lead to one. */
export function groupAt(root: FilterGroup, path: Path): FilterGroup | null {
  let current: FilterGroup = root;
  for (const index of path) {
    const child = current.children[index];
    if (child === undefined || !isGroup(child)) {
      return null;
    }
    current = child;
  }
  return current;
}

/**
 * Rebuilds the tree with `replace` applied to the group at `path`.
 *
 * Structural sharing is not the point here - a filter is tens of nodes, not
 * thousands - but returning a new root every time is, because the editor's
 * state is the root and React has to see it change.
 */
function mapGroup(
  root: FilterGroup,
  path: Path,
  replace: (group: FilterGroup) => FilterGroup,
): FilterGroup {
  if (path.length === 0) {
    return replace(root);
  }
  const [index, ...rest] = path;
  const children = root.children.map((child, at) => {
    if (at !== index || !isGroup(child)) {
      return child;
    }
    return { type: "group" as const, ...mapGroup(child, rest, replace) };
  });
  return { ...root, children };
}

export function setCombinator(
  root: FilterGroup,
  path: Path,
  combinator: FilterGroup["combinator"],
) {
  return mapGroup(root, path, (group) => ({ ...group, combinator }));
}

/** Appends a node to the group at `path`. */
export function addNode(root: FilterGroup, path: Path, node: FilterNode): FilterGroup {
  return mapGroup(root, path, (group) => ({ ...group, children: [...group.children, node] }));
}

/**
 * Removes the node at `path`.
 *
 * The root has no parent, so an empty path is a no-op rather than an error -
 * the editor never offers a way to delete it, and returning the tree unchanged
 * beats throwing from a click handler.
 */
export function removeNode(root: FilterGroup, path: Path): FilterGroup {
  if (path.length === 0) {
    return root;
  }
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1] as number;
  return mapGroup(root, parentPath, (group) => ({
    ...group,
    children: group.children.filter((_, at) => at !== index),
  }));
}

/** Replaces the rule at `path`, keeping its value consistent with its field. */
export function setRule(root: FilterGroup, path: Path, rule: FilterRule): FilterGroup {
  if (path.length === 0) {
    return root;
  }
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1] as number;
  return mapGroup(root, parentPath, (group) => ({
    ...group,
    children: group.children.map((child, at) =>
      at === index && child.type === "rule" ? { type: "rule", ...rule } : child,
    ),
  }));
}

/**
 * The columns a smart playlist may be sorted and cut off by.
 *
 * Not every `SortField`: `relevance` needs a search to rank against and
 * `position` needs a static playlist to sit in, and neither exists inside a
 * smart playlist. The backend refuses both, so leaving them out here is the
 * editor agreeing with it rather than the only thing enforcing it.
 */
export const SORT_FIELDS: { id: SortField; label: string }[] = [
  { id: "title", label: "Name" },
  { id: "artist", label: "Artist" },
  { id: "album", label: "Album" },
  { id: "albumArtist", label: "Album Artist" },
  { id: "genre", label: "Genre" },
  { id: "year", label: "Year" },
  { id: "trackNo", label: "Track Number" },
  { id: "durationMs", label: "Time" },
  { id: "addedAt", label: "Date Added" },
  { id: "playCount", label: "Plays" },
  { id: "lastPlayedAt", label: "Last Played" },
  { id: "path", label: "Location" },
];

/** What a smart playlist starts with: no order, and no cutoff. */
export const noOrder: SmartOrder = { sort: null, limit: null };

/**
 * The sort a cutoff falls back to when one is switched on without one.
 *
 * A limit with no sort is a hundred arbitrary songs, which is never what
 * somebody means by "limit this to a hundred". Date Added descending is the
 * one that reads as an answer rather than as a coin toss.
 */
export const defaultSort: SmartOrder["sort"] = { field: "addedAt", direction: "desc" };

/**
 * Keeps the two halves of an order consistent as the editor changes one.
 *
 * The rule is one-way: turning a cutoff on supplies a sort if there is none,
 * because a cutoff without one is meaningless. Turning the cutoff back off
 * leaves the sort alone - it is still a useful thing on its own, and silently
 * discarding what the user picked would be a small theft.
 */
export function withLimit(order: SmartOrder, limit: number | null): SmartOrder {
  if (limit === null) {
    return { ...order, limit: null };
  }
  return { sort: order.sort ?? defaultSort, limit };
}

/** How many rules the whole tree holds, for "N conditions" in the editor. */
export function countRules(group: FilterGroup): number {
  return group.children.reduce(
    (total, child) => total + (isGroup(child) ? countRules(child) : 1),
    0,
  );
}
