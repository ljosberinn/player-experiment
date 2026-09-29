import type { PaletteGroup } from "../../components/ui/CommandPalette";
import type { MenuItem } from "../../components/ui/ContextMenu";

/** How many entries Recent holds. */
export const RECENT_LIMIT = 8;

export const RECENT_GROUP = "Recent";

type Entry = Exclude<MenuItem, { kind: "separator" }>;

/**
 * What an entry is remembered by: its `id`, or its label within its group.
 *
 * The group is part of it because a label alone can name two commands - the
 * Edit menu's Play and the transport's. An entry whose label follows the state
 * of the app (`Remove 3 Songs…`, `Pause`, `Unlove`) carries an `id`, or it
 * would be forgotten the moment its label changed.
 */
export function entryKey(group: string, entry: Entry): string {
  return entry.id ?? `${group}/${entry.label}`;
}

/** `key` run again: moved to the front, once, within the limit. */
export function remember(recent: readonly string[], key: string): string[] {
  return [key, ...recent.filter((other) => other !== key)].slice(0, RECENT_LIMIT);
}

/** The stored list, or none for anything that is not a list of keys. */
export function parseRecents(json: string | null): string[] {
  if (json === null) {
    return [];
  }
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value)
      ? value.filter((key): key is string => typeof key === "string").slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

/**
 * The palette's groups, every command reporting its key to `onRun`, and with
 * `showRecent` the ones in `recent` ahead of them.
 *
 * Recent is resolved against what is on offer now, so an entry that has gone
 * - a deleted playlist, Next while stopped - is not listed, and a greyed one
 * is listed greyed. An entry under Recent is left out of its own group, so it
 * is listed once. Found music is neither remembered nor tracked.
 */
export function withRecents(
  groups: PaletteGroup[],
  recent: readonly string[],
  showRecent: boolean,
  onRun: (key: string) => void,
): PaletteGroup[] {
  const byKey = new Map<string, Entry>();
  const tracked = groups.map((group) =>
    group.found === true
      ? group
      : {
          ...group,
          items: group.items.map((item): MenuItem => {
            if (item.kind === "separator") {
              return item;
            }
            const key = entryKey(group.group, item);
            const { onSelect } = item;
            // Keyed by the key, so two groups' entries sharing a label can sit
            // under Recent together.
            const entry: Entry = {
              ...item,
              id: key,
              onSelect:
                onSelect === undefined
                  ? undefined
                  : () => {
                      onRun(key);
                      onSelect();
                    },
            };
            if (!byKey.has(key)) {
              byKey.set(key, entry);
            }
            return entry;
          }),
        },
  );

  const listed = new Set(showRecent ? recent.flatMap((key) => byKey.get(key) ?? []) : []);
  if (listed.size === 0) {
    return tracked;
  }
  return [
    { group: RECENT_GROUP, items: [...listed] },
    ...tracked
      .map((group) =>
        group.found === true
          ? group
          : { ...group, items: group.items.filter((item) => !listed.has(item as Entry)) },
      )
      .filter((group) => group.items.length > 0),
  ];
}
