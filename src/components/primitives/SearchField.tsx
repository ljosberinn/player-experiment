import { Icon } from "../icons/Icon";

/**
 * A text field that says what it is for with a glyph rather than a label.
 *
 * A real `<input type="search">`: the field's own behaviour - the caret, the
 * selection, the platform's clear gesture - is the thing nobody should be
 * rebuilding, and the drawing is the box around it. The magnifier is
 * `aria-hidden` and `label` is the accessible name, so the glyph is never read
 * out as a word.
 *
 * `onChange` reports every keystroke. Debouncing is the caller's - what a
 * search costs is a property of what is being searched, not of the box.
 */
export function SearchField({
  id,
  label,
  value,
  placeholder,
  disabled = false,
  onChange,
}: {
  id?: string;
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <span className="search-field">
      <Icon name="search" size={14} className="search-field-glyph" />
      <input
        id={id}
        type="search"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </span>
  );
}
