/**
 * Which sidebar sections the user has folded away.
 *
 * A pure module so the parsing can be tested without a database: what comes
 * back from `settings` is whatever was written there, which after a downgrade,
 * a hand-edit or a half-finished write may be anything at all. Every one of
 * those has to end up as "nothing is collapsed" rather than as a crash on
 * launch, because this runs before the sidebar can render.
 */

/**
 * The sections that fold.
 *
 * LIBRARY is deliberately not among them: four items that are the app's
 * primary navigation, and a user who collapsed them would have hidden the way
 * back to their songs.
 */
export const COLLAPSIBLE = ["smart", "playlists"] as const;

export type SectionId = (typeof COLLAPSIBLE)[number];

/** Collapsed by id. Absent means open, which is the default for both. */
export type Collapsed = Partial<Record<SectionId, boolean>>;

function isSectionId(value: string): value is SectionId {
  return (COLLAPSIBLE as readonly string[]).includes(value);
}

/**
 * Reads the stored arrangement, or an empty one.
 *
 * Unknown keys are dropped rather than carried: a section that existed in a
 * later version and was rolled back would otherwise sit in the settings row
 * forever, and keeping it would mean `toggle` could write back a shape this
 * version never validated.
 */
export function parseSections(stored: string | null): Collapsed {
  if (stored === null) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  const collapsed: Collapsed = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (isSectionId(key) && value === true) {
      collapsed[key] = true;
    }
  }
  return collapsed;
}

/**
 * What to write back.
 *
 * Only the collapsed ones, so the stored value stays the shorter of the two
 * states and an open sidebar writes `{}` rather than a list of falses.
 */
export function serialiseSections(collapsed: Collapsed): string {
  const folded: Collapsed = {};
  for (const id of COLLAPSIBLE) {
    if (collapsed[id] === true) {
      folded[id] = true;
    }
  }
  return JSON.stringify(folded);
}

/** Folds a section away, or opens it again. */
export function toggleSection(collapsed: Collapsed, id: SectionId): Collapsed {
  const next = { ...collapsed };
  if (next[id] === true) {
    delete next[id];
  } else {
    next[id] = true;
  }
  return next;
}
