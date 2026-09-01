import { Dialog } from "@base-ui/react/dialog";
import { useId, useRef, useState } from "react";
import { TagCombobox } from "../../components/ui/TagCombobox";
import type {
  FilterField,
  FilterGroup,
  FilterOp,
  FilterRule,
  FilterValue,
  SmartOrder,
  SortDirection,
  SortField,
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
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup
          className="modal"
          render={
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (canSave) {
                  onSave(draftName.trim(), draft, draftOrder);
                }
              }}
            />
          }
        >
          {/* biome-ignore lint/a11y/useHeadingContent: the heading's content is this component's children, which Base UI puts inside the rendered <h2> - the rule only sees the empty element literal. */}
          <Dialog.Title render={<h2 />}>{title}</Dialog.Title>

          <label className="modal-field" htmlFor={nameId}>
            Name
            <input
              id={nameId}
              value={draftName}
              onChange={(event) => changeName(event.currentTarget.value)}
            />
          </label>

          <GroupEditor group={draft} path={[]} root onChange={changeDraft} />

          <OrderEditor order={draftOrder} onChange={setDraftOrder} />

          <p className="modal-summary">
            {countRules(draft) === 0
              ? "No conditions yet — this playlist will hold your whole library."
              : `${countRules(draft)} condition${countRules(draft) === 1 ? "" : "s"}.`}
          </p>

          <div className="modal-actions">
            <Dialog.Close render={<button type="button" />}>Cancel</Dialog.Close>
            <button type="submit" className="primary" disabled={!canSave}>
              Save
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
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
        <input
          id={sortId}
          type="checkbox"
          checked={order.sort !== null}
          // Unticking discards the sort, unless a cutoff is relying on it - a
          // limit with no sort is a hundred arbitrary songs, so the two
          // controls are not quite independent and the checkbox says so by
          // refusing rather than by silently leaving itself ticked.
          disabled={limited}
          onChange={(event) =>
            onChange({
              ...order,
              sort: event.currentTarget.checked ? { field: "addedAt", direction: "desc" } : null,
            })
          }
        />
        <label htmlFor={sortId}>Sorted by</label>

        <select
          aria-label="Sort by"
          disabled={order.sort === null}
          value={order.sort?.field ?? "addedAt"}
          onChange={(event) =>
            onChange({
              ...order,
              sort: {
                field: event.currentTarget.value as SortField,
                direction: order.sort?.direction ?? "desc",
              },
            })
          }
        >
          {SORT_FIELDS.map((field) => (
            <option key={field.id} value={field.id}>
              {field.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Sort direction"
          disabled={order.sort === null}
          value={order.sort?.direction ?? "desc"}
          onChange={(event) =>
            onChange({
              ...order,
              sort: {
                field: order.sort?.field ?? "addedAt",
                direction: event.currentTarget.value as SortDirection,
              },
            })
          }
        >
          <option value="desc">descending</option>
          <option value="asc">ascending</option>
        </select>
      </div>

      <div className="filter-row">
        <input
          id={limitId}
          type="checkbox"
          checked={limited}
          onChange={(event) => {
            if (event.currentTarget.checked) {
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
      <div className="filter-row">
        <span>{label}</span>
        <select
          aria-label={root ? "Match rules" : "Match rules in this group"}
          value={group.combinator}
          onChange={(event) =>
            onChange(
              setCombinator(group, [], event.currentTarget.value as FilterGroup["combinator"]),
            )
          }
        >
          <option value="all">all</option>
          <option value="any">any</option>
        </select>
        <span>of the following:</span>
        <span className="filter-spacer" />
        <button
          type="button"
          onClick={() => onChange(addNode(group, [], { type: "rule", ...newRule() }))}
        >
          + Rule
        </button>
        <button
          type="button"
          onClick={() => onChange(addNode(group, [], { type: "group", ...newGroup() }))}
        >
          + Group
        </button>
        {onRemove ? (
          <button type="button" aria-label="Remove group" onClick={onRemove}>
            ✕
          </button>
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
    <div className="filter-row filter-rule">
      <select
        aria-label={`Field for condition ${position}`}
        value={rule.field}
        onChange={(event) => changeField(event.currentTarget.value as FilterField)}
      >
        {FIELDS.map((field) => (
          <option key={field.id} value={field.id}>
            {field.label}
          </option>
        ))}
      </select>

      <select
        aria-label={`Condition ${position} on ${labelOf(rule.field)}`}
        value={rule.op}
        onChange={(event) => {
          const op = event.currentTarget.value as FilterOp;
          onChange({ ...rule, op, value: valueFor(rule.field, op, rule.value) });
        }}
      >
        {opsFor(rule.field).map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </select>

      <ValueEditor
        value={rule.value}
        position={position}
        vocabulary={vocabularyFor(rule.field)}
        onChange={(value) => onChange({ ...rule, value })}
      />

      {rule.op === "inLast" ? <span>days</span> : null}

      <span className="filter-spacer" />
      <button type="button" aria-label={`Remove condition ${position}`} onClick={onRemove}>
        ✕
      </button>
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
