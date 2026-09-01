import type { FilterGroup, FilterRule, FilterValue } from "../../ipc";
import { labelOf, OP_LABELS } from "./filterTree";

/**
 * Whether a single-rule filter has a name worth taking - see issue 52.
 *
 * A tree of several rules has no short honest name, so everything here
 * answers "what does the one rule at the root suggest" and refuses anything
 * else: a nested group, a second rule, or no rule at all.
 */

/** The lone rule at the root, or null for zero, several, or a nested group. */
function onlyRule(filter: FilterGroup): FilterRule | null {
  if (filter.children.length !== 1) {
    return null;
  }
  const child = filter.children[0];
  return child !== undefined && child.type === "rule" ? child : null;
}

/** A value's plain-text reading, or null where no single line answers it - a range, or a valueless op like "is empty". */
function textOf(value: FilterValue): string | null {
  if (value.kind === "text") {
    return value.text.trim() || null;
  }
  if (value.kind === "number") {
    return String(value.number);
  }
  return null;
}

/** The sentence the rule's own field/operator/value controls already spell out ("Artist is Rome"). */
function describeRule(rule: FilterRule): string {
  const condition = `${labelOf(rule.field)} ${OP_LABELS[rule.op]}`;
  const value = textOf(rule.value);
  return value === null ? condition : `${condition} ${value}`;
}

/**
 * A name that tells a reader nothing they could not already see on screen:
 * still `defaultName`, or the single rule restated in the sentence its own
 * controls already spell out. Either way it is not a name somebody chose.
 */
export function isUninformative(name: string, filter: FilterGroup, defaultName: string): boolean {
  if (name === defaultName) {
    return true;
  }
  const rule = onlyRule(filter);
  return rule !== null && name === describeRule(rule);
}

/**
 * What a single-rule filter would name itself, or null when there is nothing
 * short and honest to offer: several rules, no rule yet, or a value with no
 * one-line reading (empty text, a range, an "is empty" check).
 */
export function suggestedName(filter: FilterGroup): string | null {
  const rule = onlyRule(filter);
  return rule === null ? null : textOf(rule.value);
}
