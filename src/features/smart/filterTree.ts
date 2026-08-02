import type {
  FilterField,
  FilterGroup,
  FilterNode,
  FilterOp,
  FilterRule,
  FilterValue,
} from "../../ipc";

/**
 * Editing operations on a filter tree.
 *
 * Pure and separate from the editor component: a nested and/or tree is where
 * the bugs live, not in the inputs that render it.
 *
 * **This file mirrors a table that also exists in Rust** (`model.rs`'s
 * `FilterField::kind` and `smart::compile`'s operator match). The backend
 * validates every filter by compiling it before storing, so the two drifting
 * apart shows up as the editor offering a combination the backend refuses -
 * annoying, never unsafe.
 */

export type FieldKind = "text" | "number" | "timestamp";

export interface FieldDef {
  id: FilterField;
  label: string;
  kind: FieldKind;
}

export const FIELDS: FieldDef[] = [
  { id: "title", label: "Name", kind: "text" },
  { id: "artist", label: "Artist", kind: "text" },
  { id: "album", label: "Album", kind: "text" },
  { id: "albumArtist", label: "Album Artist", kind: "text" },
  { id: "genre", label: "Genre", kind: "text" },
  { id: "comment", label: "Comment", kind: "text" },
  { id: "path", label: "Location", kind: "text" },
  { id: "year", label: "Year", kind: "number" },
  { id: "trackNo", label: "Track Number", kind: "number" },
  { id: "discNo", label: "Disc Number", kind: "number" },
  { id: "durationMs", label: "Time (ms)", kind: "number" },
  { id: "bitrate", label: "Bit Rate", kind: "number" },
  { id: "sampleRate", label: "Sample Rate", kind: "number" },
  { id: "playCount", label: "Plays", kind: "number" },
  { id: "addedAt", label: "Date Added", kind: "timestamp" },
  { id: "lastPlayedAt", label: "Last Played", kind: "timestamp" },
];

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

const OPS_BY_KIND: Record<FieldKind, FilterOp[]> = {
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

export function kindOf(field: FilterField): FieldKind {
  return FIELDS.find((definition) => definition.id === field)?.kind ?? "text";
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

/** How many rules the whole tree holds, for "N conditions" in the editor. */
export function countRules(group: FilterGroup): number {
  return group.children.reduce(
    (total, child) => total + (isGroup(child) ? countRules(child) : 1),
    0,
  );
}
