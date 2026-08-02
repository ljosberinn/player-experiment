import { useId, useState } from "react";
import type { FilterField, FilterGroup, FilterOp, FilterRule, FilterValue } from "../../ipc";
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
  setCombinator,
  setRule,
  valueFor,
} from "./filterTree";

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
  onSave,
  onCancel,
}: {
  title: string;
  name: string;
  filter: FilterGroup;
  onSave: (name: string, filter: FilterGroup) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(filter);
  const [draftName, setDraftName] = useState(name);
  const headingId = useId();
  const nameId = useId();

  return (
    <div className="modal-backdrop">
      {/* A div with role="dialog" rather than <dialog>: the native element only
          gets its backdrop and focus trap from showModal(), which means an
          effect, and jsdom does not implement it at all. */}
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <h2 id={headingId}>{title}</h2>

        <label className="modal-field" htmlFor={nameId}>
          Name
          <input
            id={nameId}
            value={draftName}
            onChange={(event) => setDraftName(event.currentTarget.value)}
          />
        </label>

        <GroupEditor group={draft} path={[]} root onChange={setDraft} />

        <p className="modal-summary">
          {countRules(draft) === 0
            ? "No conditions yet — this playlist will hold your whole library."
            : `${countRules(draft)} condition${countRules(draft) === 1 ? "" : "s"}.`}
        </p>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={draftName.trim() === ""}
            onClick={() => onSave(draftName.trim(), draft)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
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
  onChange,
}: {
  value: FilterValue;
  position: number;
  onChange: (value: FilterValue) => void;
}) {
  if (value.kind === "none") {
    return null;
  }

  if (value.kind === "text") {
    return (
      <input
        aria-label={`Value for condition ${position}`}
        value={value.text}
        onChange={(event) => onChange({ kind: "text", text: event.currentTarget.value })}
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
