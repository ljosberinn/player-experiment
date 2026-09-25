import { useId, useRef, useState } from "react";
import { Button } from "../../components/primitives/Button";
import { Checkbox } from "../../components/primitives/Checkbox";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogStatus,
} from "../../components/primitives/Dialog";
import { IconButton } from "../../components/primitives/IconButton";
import { Select } from "../../components/primitives/Select";
import { TagCombobox } from "../../components/ui/TagCombobox";
import type {
  FilterField,
  FilterGroup,
  FilterOp,
  FilterRule,
  FilterValue,
  SmartOrder,
  TagValueField,
} from "../../ipc";
import {
  addNode,
  countRules,
  FIELDS,
  labelOf,
  newGroup,
  newRule,
  OP_LABELS,
  opsFor,
  type Path,
  removeNode,
  SORT_FIELDS,
  setCombinator,
  setRule,
  valueFor,
  vocabularyFor,
  withLimit,
} from "./filterTree";
import { isUninformative, suggestedName } from "./nameFromRule";

/**
 * The filter-tree editor.
 *
 * A dialog rather than an inline panel: building a filter is a task with a
 * beginning and an end, and the result replaces the view behind it.
 */
export function SmartPlaylistEditor({
  title,
  name,
  filter,
  order,
  isNew = false,
  onSave,
  onCancel,
}: {
  title: string;
  name: string;
  filter: FilterGroup;
  order: SmartOrder;
  /** Whether this playlist has never been saved - only this one derives its name from its rule; see issue 52. */
  isNew?: boolean;
  onSave: (name: string, filter: FilterGroup, order: SmartOrder) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(filter);
  const [draftName, setDraftName] = useState(name);
  const [draftOrder, setDraftOrder] = useState(order);
  const nameId = useId();
  const canSave = draftName.trim() !== "";

  // A new playlist's name follows its single rule until the user types
  // something into the field themselves - a ref rather than state because
  // flipping it must never itself cause a render, only the writes it gates
  // do. Retyping the default stops it same as any other edit (the compare
  // against `name` below), but retyping the sentence the rule's own controls
  // already spell out does not - that string is exactly as uninformative as
  // the default it would otherwise replace.
  const derivingRef = useRef(isNew);

  const changeDraft = (next: FilterGroup) => {
    setDraft(next);
    if (derivingRef.current) {
      setDraftName(suggestedName(next) ?? name);
    }
  };

  const changeName = (value: string) => {
    if (derivingRef.current) {
      derivingRef.current = value !== name && isUninformative(value, draft, name);
    }
    setDraftName(value);
  };

  return (
    // As with the tag editor: open on render, Escape is the library's, and
    // Enter-to-save is a real submit rather than a key handler that has to
    // guess which elements to leave alone. That matters more here - the tree
    // is full of selects and buttons, which is precisely the list
    // `useDialogKeys` was maintaining by hand.
    <Dialog
      onClose={onCancel}
      onSubmit={() => {
        if (canSave) {
          onSave(draftName.trim(), draft, draftOrder);
        }
      }}
    >
      <DialogHeader title={title} />

      <DialogBody>
        <label className="dialog-field filter-name" htmlFor={nameId}>
          {/* A span rather than a bare text node: the sheet gives the caption a
              column of its own, and only an element can be given a width. */}
          <span className="filter-name-label">Name</span>
          <input
            id={nameId}
            value={draftName}
            onChange={(event) => changeName(event.currentTarget.value)}
          />
        </label>

        <GroupEditor group={draft} path={[]} root onChange={changeDraft} />

        <OrderEditor order={draftOrder} onChange={setDraftOrder} />
      </DialogBody>

      <DialogFooter
        lead={
          <DialogStatus>
            {countRules(draft) === 0
              ? "No conditions — includes your whole library."
              : `${countRules(draft)} condition${countRules(draft) === 1 ? "" : "s"}.`}
          </DialogStatus>
        }
      >
        <DialogClose>Cancel</DialogClose>
        <Button kind="primary" type="submit" disabled={!canSave}>
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** What a "limited to" box offers when it is switched on. */
const DEFAULT_LIMIT = 100;

/**
 * The sort and cutoff, one line under the rules.
 *
 * Two checkboxes rather than a sentinel value in each control: "sorted by
 * nothing" and "limited to no songs" both need to be expressible, and a select
 * with a blank first option says that far less clearly than a box you tick.
 *
 * The cutoff is what makes "Most Played" a smart playlist rather than a special
 * case, so its label says what it actually does - it decides which songs are in
 * the playlist, not merely the order they appear in.
 */
function OrderEditor({
  order,
  onChange,
}: {
  order: SmartOrder;
  onChange: (next: SmartOrder) => void;
}) {
  const sortId = useId();
  const limitId = useId();
  const limited = order.limit !== null;

  // The box holds text, the order holds a number, and the two are not the same
  // thing: clearing it to retype has to leave an empty box rather than snapping
  // to the clamped value, or the next keystroke lands beside a digit the user
  // did not type. What the order carries meanwhile is the clamped reading.
  const [limitText, setLimitText] = useState(String(order.limit ?? DEFAULT_LIMIT));

  return (
    <div className="filter-order">
      <div className="filter-row">
        <Checkbox
          id={sortId}
          checked={order.sort !== null}
          // Unticking discards the sort, unless a cutoff is relying on it - a
          // limit with no sort is a hundred arbitrary songs, so the two
          // controls are not quite independent and the checkbox says so by
          // refusing rather than by silently leaving itself ticked.
          disabled={limited}
          onChange={(checked) =>
            onChange({
              ...order,
              sort: checked ? { field: "addedAt", direction: "desc" } : null,
            })
          }
        />
        <label htmlFor={sortId}>Sorted by</label>

        <Select
          label="Sort by"
          disabled={order.sort === null}
          value={order.sort?.field ?? "addedAt"}
          options={SORT_FIELDS.map((field) => ({ value: field.id, label: field.label }))}
          onChange={(field) =>
            onChange({
              ...order,
              sort: { field, direction: order.sort?.direction ?? "desc" },
            })
          }
        />

        <Select
          label="Sort direction"
          disabled={order.sort === null}
          value={order.sort?.direction ?? "desc"}
          options={[
            { value: "desc", label: "descending" },
            { value: "asc", label: "ascending" },
          ]}
          onChange={(direction) =>
            onChange({
              ...order,
              sort: { field: order.sort?.field ?? "addedAt", direction },
            })
          }
        />
      </div>

      <div className="filter-row">
        <Checkbox
          id={limitId}
          checked={limited}
          onChange={(checked) => {
            if (checked) {
              setLimitText(String(DEFAULT_LIMIT));
              onChange(withLimit(order, DEFAULT_LIMIT));
            } else {
              onChange(withLimit(order, null));
            }
          }}
        />
        <label htmlFor={limitId}>Limited to</label>

        <input
          type="number"
          aria-label="Limit"
          min={1}
          disabled={!limited}
          value={limitText}
          onChange={(event) => {
            const raw = event.currentTarget.value;
            setLimitText(raw);
            onChange(withLimit(order, toLimit(raw)));
          }}
        />
        <span>songs</span>
      </div>
    </div>
  );
}

/**
 * A half-typed or emptied limit box reads as one song rather than as zero.
 *
 * Zero is refused by the backend - a playlist that is empty by construction is
 * always a slip - and clearing the box to retype the number is not a request
 * for one. Clamping keeps the editor from producing a value it would then have
 * to report an error about.
 */
function toLimit(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
}

function GroupEditor({
  group,
  path,
  root = false,
  onChange,
  onRemove,
}: {
  group: FilterGroup;
  path: Path;
  root?: boolean;
  onChange: (next: FilterGroup) => void;
  onRemove?: () => void;
}) {
  const label = root ? "Match" : "and match";

  return (
    <div className={root ? "filter-group root" : "filter-group"}>
      {/* Not a rule row. It spans the grid rather than taking its columns, so
          the selects below it start at the box's own left edge. */}
      <div className="filter-head">
        <span>{label}</span>
        <Select
          label={root ? "Match rules" : "Match rules in this group"}
          value={group.combinator}
          options={[
            { value: "all", label: "all" },
            { value: "any", label: "any" },
          ]}
          onChange={(combinator) => onChange(setCombinator(group, [], combinator))}
        />
        <span>of the following:</span>
        <span className="filter-spacer" />
        <Button onClick={() => onChange(addNode(group, [], { type: "rule", ...newRule() }))}>
          + Rule
        </Button>
        <Button onClick={() => onChange(addNode(group, [], { type: "group", ...newGroup() }))}>
          + Group
        </Button>
        {onRemove ? (
          <IconButton icon="remove" label="Remove group" place="rule" onClick={onRemove} />
        ) : null}
      </div>

      {group.children.length === 0 ? (
        <p className="filter-empty">Nothing here yet — every song matches.</p>
      ) : null}

      {group.children.map((child, index) => {
        // Index keys: a rule has no identity of its own, and reordering is not
        // offered here, so position is a stable enough key for this list.
        const childPath = [...path, index];
        const key = childPath.join("-");

        if (child.type === "group") {
          return (
            <GroupEditor
              key={key}
              group={child}
              path={childPath}
              onChange={(next) =>
                onChange({
                  ...group,
                  children: group.children.map((existing, at) =>
                    at === index ? { type: "group", ...next } : existing,
                  ),
                })
              }
              onRemove={() => onChange(removeNode(group, [index]))}
            />
          );
        }

        return (
          <RuleEditor
            key={key}
            rule={child}
            index={index}
            onChange={(next) => onChange(setRule(group, [index], next))}
            onRemove={() => onChange(removeNode(group, [index]))}
          />
        );
      })}
    </div>
  );
}

function RuleEditor({
  rule,
  index,
  onChange,
  onRemove,
}: {
  rule: FilterRule;
  index: number;
  onChange: (next: FilterRule) => void;
  onRemove: () => void;
}) {
  // Numbered so the controls have distinguishable names: several rules on the
  // same screen otherwise all announce as "Field".
  const position = index + 1;

  const changeField = (field: FilterField) => {
    // The operator may not survive the new field - "contains" means nothing on
    // a year - so it falls back to the first one that does.
    const op = opsFor(field).includes(rule.op) ? rule.op : (opsFor(field)[0] as FilterOp);
    onChange({ field, op, value: valueFor(field, op, rule.value) });
  };

  return (
    // `display: contents`, so these four are the group's own grid cells rather
    // than a row packing its own flex. The third is a box rather than the
    // control itself because two of the four value shapes put more than one
    // thing in it, and an empty box is what `kind: "none"` leaves behind.
    <div className="filter-rule">
      <Select
        label={`Field for condition ${position}`}
        value={rule.field}
        options={FIELDS.map((field) => ({ value: field.id, label: field.label }))}
        onChange={changeField}
      />

      <Select
        label={`Condition ${position} on ${labelOf(rule.field)}`}
        value={rule.op}
        options={opsFor(rule.field).map((op) => ({ value: op, label: OP_LABELS[op] }))}
        onChange={(op) => onChange({ ...rule, op, value: valueFor(rule.field, op, rule.value) })}
      />

      <div className="filter-value">
        <ValueEditor
          value={rule.value}
          position={position}
          vocabulary={vocabularyFor(rule.field)}
          onChange={(value) => onChange({ ...rule, value })}
        />

        {rule.op === "inLast" ? <span>days</span> : null}
      </div>

      <IconButton
        icon="remove"
        label={`Remove condition ${position}`}
        place="rule"
        onClick={onRemove}
      />
    </div>
  );
}

function ValueEditor({
  value,
  position,
  vocabulary,
  onChange,
}: {
  value: FilterValue;
  position: number;
  /** Which existing values to suggest, or null where the field has none. */
  vocabulary: TagValueField | null;
  onChange: (value: FilterValue) => void;
}) {
  if (value.kind === "none") {
    return null;
  }

  if (value.kind === "text") {
    // `is` and `is not` want the vocabulary exactly; `contains` wants it too,
    // and matches loosely on top of whatever is picked. So the suggestions do
    // not vary by operator - only by field.
    return (
      <TagCombobox
        ariaLabel={`Value for condition ${position}`}
        field={vocabulary}
        value={value.text}
        onChange={(text) => onChange({ kind: "text", text })}
      />
    );
  }

  if (value.kind === "number") {
    return (
      <input
        type="number"
        aria-label={`Value for condition ${position}`}
        value={value.number}
        onChange={(event) =>
          onChange({ kind: "number", number: toNumber(event.currentTarget.value) })
        }
      />
    );
  }

  return (
    <>
      <input
        type="number"
        aria-label={`Lower bound for condition ${position}`}
        value={value.from}
        onChange={(event) => onChange({ ...value, from: toNumber(event.currentTarget.value) })}
      />
      <span>and</span>
      <input
        type="number"
        aria-label={`Upper bound for condition ${position}`}
        value={value.to}
        onChange={(event) => onChange({ ...value, to: toNumber(event.currentTarget.value) })}
      />
    </>
  );
}

/** An emptied or half-typed number box reads as zero rather than as NaN. */
function toNumber(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
