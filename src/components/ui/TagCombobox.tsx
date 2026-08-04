import { Autocomplete } from "@base-ui/react/autocomplete";
import { useEffect, useRef, useState } from "react";
import { suggestTagValues, type TagValueField } from "../../ipc";

/** The same debounce the search box uses, for the same reason. */
export const SUGGEST_DEBOUNCE_MS = 150;

/**
 * The values already in the library for `field`, for what has been typed.
 *
 * Debounced, because this is a round trip to SQLite on every keystroke
 * otherwise. Results that arrive after a newer query was sent are dropped: a
 * slow lookup for "bea" must not overwrite the list for "beach".
 */
export function useTagSuggestions(field: TagValueField | null, query: string): string[] {
  const [items, setItems] = useState<string[]>([]);
  // Monotonic, so a late response can tell it is late.
  const latest = useRef(0);

  useEffect(() => {
    if (field === null) {
      setItems([]);
      return;
    }
    const token = latest.current + 1;
    latest.current = token;

    const timer = setTimeout(() => {
      void suggestTagValues(field, query)
        .then((found) => {
          if (latest.current === token) {
            setItems(found);
          }
        })
        .catch(() => {
          // A failed lookup means no suggestions, not an error state. The
          // field still works as free text, which is the whole point of it
          // staying free text.
          if (latest.current === token) {
            setItems([]);
          }
        });
    }, SUGGEST_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [field, query]);

  return items;
}

/**
 * A text field that offers what the library already says.
 *
 * Typing "Godspeed You! Black Emperor" correctly by hand for the fourth time is
 * how a library acquires three spellings of one band.
 *
 * It is a suggestion list, not a picker: the input stays free text, because a
 * band the library has never seen has to be typeable. Nothing is ever filled in
 * without a deliberate Enter, Tab or click.
 *
 * `mode="none"` because the filtering happens in SQLite - Base UI would
 * otherwise filter the eight rows it was given a second time, by its own rules,
 * and disagree with the ranking the query just applied.
 */
export function TagCombobox({
  id,
  ariaLabel,
  field,
  value,
  placeholder,
  className,
  onChange,
  onKeyDown,
}: {
  id?: string | undefined;
  /** For the filter editor, whose rules are labelled by position, not by a <label>. */
  ariaLabel?: string | undefined;
  /** Which vocabulary to offer, or null for a field that has none. */
  field: TagValueField | null;
  value: string;
  placeholder?: string | undefined;
  className?: string | undefined;
  onChange: (value: string) => void;
  /** The host's own key handling - Enter to save, Escape to cancel. */
  onKeyDown?: ((event: React.KeyboardEvent<HTMLInputElement>) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const items = useTagSuggestions(field, value);

  // A field with no shared vocabulary gets a plain input and no listbox at all
  // - not an empty one. A comment or a title is per-song by nature, and a
  // dropdown of other songs' comments is a way to paste the wrong data.
  if (field === null) {
    return (
      <input
        id={id}
        aria-label={ariaLabel}
        className={className}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
    );
  }

  return (
    <Autocomplete.Root
      mode="none"
      items={items}
      value={value}
      onValueChange={(next) => onChange(next)}
      open={open && items.length > 0}
      onOpenChange={setOpen}
    >
      <Autocomplete.Input
        id={id}
        aria-label={ariaLabel}
        className={className}
        placeholder={placeholder}
        // No Escape handling here on purpose. The plan flagged this as the
        // delicate part - Escape has to close the list without also reaching
        // `useDialogKeys`, which takes it as "cancel the edit" - and it turns
        // out Base UI already stops the event while the list is open. A
        // hand-rolled `stopPropagation` was written first and then deleted
        // after a test proved it changed nothing; `TagEditor.test.tsx` asserts
        // the behaviour so it stays true rather than staying accidental.
        onKeyDown={onKeyDown}
      />
      <Autocomplete.Portal>
        <Autocomplete.Positioner className="suggest-positioner" sideOffset={4}>
          <Autocomplete.Popup className="suggest-popup">
            <Autocomplete.List>
              {(item: string) => (
                <Autocomplete.Item key={item} value={item} className="suggest-item">
                  {item}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
