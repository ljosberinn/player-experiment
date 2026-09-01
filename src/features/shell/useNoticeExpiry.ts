import { useEffect } from "react";

/**
 * Clears `value` after `ms`, restarting whenever a new value arrives.
 *
 * One effect behind the three notices that share the header slot - the
 * toolbar's, the playlists store's, and the tag editor's - which used to be
 * three copies of the same timer, one of them missing entirely.
 */
export function useNoticeExpiry(value: string | null, clear: () => void, ms: number): void {
  useEffect(() => {
    if (value === null) {
      return;
    }
    const timer = setTimeout(clear, ms);
    return () => clearTimeout(timer);
  }, [value, clear, ms]);
}
