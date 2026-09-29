import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog } from "../primitives/Dialog";
import { keyshortcuts, type MenuItem } from "./ContextMenu";

/** One heading's worth of entries, in the vocabulary the menus are built in. */
export interface PaletteGroup {
  group: string;
  /** One level deep: a submenu here is not drawn. */
  items: MenuItem[];
}

type Entry = Exclude<MenuItem, { kind: "separator" }>;

/**
 * Every typed word appears somewhere in the label, in any order.
 *
 * A whole-query substring would miss `settings library` against
 * `Settings › Library`, the path separator being in the way.
 */
export function matches(label: string, query: string): boolean {
  const haystack = label.toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/**
 * Everything the menus and the shortcuts do, found by typing.
 *
 * Base UI's command palette recipe: an inline `Autocomplete`, always open,
 * inside a dialog. The rows are drawn as `renderMenuItem` draws a menu's, so a
 * greyed entry, a hint and a keystroke read the same in both.
 */
export function CommandPalette({
  groups,
  onClose,
}: {
  groups: PaletteGroup[];
  onClose: () => void;
}) {
  const items = groups.map(({ group, items }) => ({
    value: group,
    items: items.filter((item): item is Entry => item.kind !== "separator"),
  }));

  return (
    <Dialog paned variant="palette" label="Command palette" onClose={onClose}>
      <Autocomplete.Root
        open
        inline
        items={items}
        itemToStringValue={(entry: Entry) => entry.label}
        filter={(entry: Entry, query) => matches(entry.label, query)}
        autoHighlight="always"
        keepHighlight
      >
        <div className="palette-field">
          <Autocomplete.Input aria-label="Search commands" placeholder="Type a command" />
        </div>
        <div className="dialog-body palette-body">
          <Autocomplete.Empty>
            <p className="palette-empty">No matching command.</p>
          </Autocomplete.Empty>
          <Autocomplete.List>
            {(group: (typeof items)[number]) => (
              <Autocomplete.Group key={group.value} items={group.items} className="palette-group">
                <Autocomplete.GroupLabel className="palette-group-label">
                  {group.value}
                </Autocomplete.GroupLabel>
                <Autocomplete.Collection>
                  {(entry: Entry) => (
                    <Autocomplete.Item
                      key={entry.id ?? entry.label}
                      value={entry}
                      disabled={entry.disabled}
                      className="menu-item"
                      aria-keyshortcuts={
                        entry.shortcut === undefined ? undefined : keyshortcuts(entry.shortcut)
                      }
                      aria-label={
                        entry.hint === undefined ? undefined : `${entry.label}. ${entry.hint}`
                      }
                      onClick={() => {
                        // Closed first, so a dialog the entry opens is not
                        // handed focus by a palette that is still closing.
                        onClose();
                        entry.onSelect?.();
                      }}
                    >
                      <span className="menu-label">{entry.label}</span>
                      {entry.hint === undefined ? null : (
                        <span className="menu-hint">{entry.hint}</span>
                      )}
                      {entry.shortcut === undefined ? null : (
                        <span className="menu-shortcut" aria-hidden="true">
                          {entry.shortcut}
                        </span>
                      )}
                    </Autocomplete.Item>
                  )}
                </Autocomplete.Collection>
              </Autocomplete.Group>
            )}
          </Autocomplete.List>
        </div>
      </Autocomplete.Root>
    </Dialog>
  );
}
