import { type ListenQuery, type ListenTotals, statsListenTotals } from "../../ipc";

/**
 * The last totals asked for, so two panels asking the same question ask once.
 *
 * Panels load independently on purpose - that is what keeps a range change out
 * of `App`'s render - but the tile row and the genre panel's coverage caption
 * want the same answer, and `listen_totals` is the dearest aggregate in the
 * set: three distinct counts over one scan of the whole log.
 *
 * One entry, not a cache. Every panel moves to the new filters together, so
 * the entry before last has no reader; a map keyed by query would grow for the
 * length of the session to serve nobody.
 *
 * The promise is stored rather than its result, so a second panel asking while
 * the first is still in flight joins it rather than starting a second scan. A
 * rejection is dropped, so the next mount retries instead of being told about
 * a failure that has since been fixed.
 */
let held: { key: string; totals: Promise<ListenTotals> } | null = null;

export function listenTotalsOnce(query: ListenQuery): Promise<ListenTotals> {
  const key = JSON.stringify(query);
  if (held?.key !== key) {
    const totals = statsListenTotals(query);
    held = { key, totals };
    totals.catch(() => {
      if (held?.totals === totals) {
        held = null;
      }
    });
  }
  return held.totals;
}

/** Drops what is held. For tests, which must not see the last one's answer. */
export function forgetListenTotals(): void {
  held = null;
}
