import { type Loving, lovingFor } from "../library/rowMenu";
import { useLastfmStore } from "./store";

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
 * else re-rendered the bar. The set moves only when the user loves something,
 * so the subscription costs one render per press.
 */
export function useLoveEntry(
  ids: number[],
  trackById: (id: number) => { artist: string | null; title: string | null } | null,
): Loving | undefined {
  const configured = useLastfmStore((s) => s.configured);
  const username = useLastfmStore((s) => s.username);
  const loved = useLastfmStore((s) => s.loved);
  const love = useLastfmStore((s) => s.love);

  return lovingFor({
    ids,
    trackById,
    configured,
    connected: username !== null,
    loved,
    onToggle: (next) => void love(ids, next),
  });
}
