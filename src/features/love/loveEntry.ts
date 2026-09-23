import { type Loving, lovingFor } from "../library/rowMenu";
import { useLovedStore } from "./store";

/**
 * The Love entry's state for a selection, or nothing where the entry does not
 * belong.
 *
 * The one place the two menus that offer it agree on what Love means, so the
 * Edit menu and the right-click menu cannot drift the way `rowMenuItems`
 * exists to stop.
 *
 * **Subscribed rather than read once.** Both menus build their items during a
 * render, and a menu opened after a love has to say Unlove - reading the set
 * with `getState()` would leave the Edit menu one love behind until something
 * else re-rendered the bar. The set moves only when the user loves something
 * or last.fm's loves arrive, so the subscription costs one render per move.
 */
export function useLoveEntry(
  ids: number[],
  trackById: (id: number) => { artist: string | null; title: string | null } | null,
): Loving | undefined {
  const loved = useLovedStore((s) => s.loved);
  const love = useLovedStore((s) => s.love);

  return lovingFor({
    ids,
    trackById,
    loved,
    onToggle: (next) => void love(ids, next),
  });
}
