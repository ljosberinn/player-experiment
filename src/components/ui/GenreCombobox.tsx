import { Autocomplete } from "@base-ui/react/autocomplete";
import { useEffect, useRef, useState } from "react";
import { genreSuggestions } from "../../ipc";
import { SUGGEST_DEBOUNCE_MS } from "./TagCombobox";

/**
 * The genre labels the tree knows, for what has been typed.
 *
 * Debounced and late-answer-guarded for the reasons `useTagSuggestions` is: a
 * round trip to SQLite per keystroke otherwise, and a slow lookup for "bla"
 * must not overwrite the list for "black".
 */
function useGenreSuggestions(query: string): string[] {
  const [items, setItems] = useState<string[]>([]);
  const latest = useRef(0);

  useEffect(() => {
    const token = latest.current + 1;
    latest.current = token;

    const timer = setTimeout(() => {
      void genreSuggestions(query)
        .then((found) => {
          if (latest.current === token) {
            setItems(found);
          }
        })
        .catch(() => {
          // No suggestions is not an error state. The field is free text and
          // `set_override` is what refuses a label the tree does not know.
          if (latest.current === token) {
            setItems([]);
          }
        });
    }, SUGGEST_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  return items;
}

/**
 * A text field that offers the genre tree's own labels.
 *
 * Its own component rather than a mode on [`TagCombobox`], which offers the
 * values a `tracks` column already holds. The two answer different questions -
 * one is what files are tagged with, the other is what branches exist - and
 * `TagCombobox`'s contract is written around the first.
 *
 * **Still free text**, like that one. 6,575 labels is too many to pick from
 * blind, and the refusal that matters lives in `set_override`, where no caller
 * can skip it: a parent the tree does not know comes back named rather than as
 * a foreign key violation.
 *
 * `mode="none"` because the filtering happens in SQLite - Base UI would
 * otherwise filter the eight rows it was given a second time, by its own
 * rules, and disagree with the ranking the query just applied.
 */
export function GenreCombobox({
  id,
  value,
  placeholder,
  onChange,
  onKeyDown,
}: {
  id?: string | undefined;
  value: string;
  placeholder?: string | undefined;
  onChange: (value: string) => void;
  /** The host's own key handling - Enter to save, Escape to cancel. */
  onKeyDown?: ((event: React.KeyboardEvent<HTMLInputElement>) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const items = useGenreSuggestions(value);

  return (
    <Autocomplete.Root
      mode="none"
      items={items}
      value={value}
      onValueChange={(next) => onChange(next)}
      open={open && items.length > 0}
      onOpenChange={setOpen}
    >
      <Autocomplete.Input id={id} placeholder={placeholder} onKeyDown={onKeyDown} />
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
