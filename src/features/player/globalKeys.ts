/**
 * What a media key can do.
 *
 * Its own union rather than `PlayerShortcut`: the two sets genuinely differ.
 * There is no global seek or volume - those are the arrow keys, which stay
 * window-scoped - and `stop` exists only here, because a media keyboard that
 * has the key expects it to work while `shortcuts.ts` has never needed it.
 */
export type MediaKeyAction = "toggle" | "next" | "previous" | "stop";

/**
 * The keys registered with the OS, and what each does.
 *
 * **Media keys only, and deliberately not Space.** A global shortcut is
 * exclusive: the OS routes it to whoever claimed it and to nobody else. Space
 * registered system-wide would stop the space bar working in every other
 * application on the machine - a spectacular way to break someone's computer
 * in exchange for a shortcut that already works when the window has focus.
 *
 * The in-window bindings in `shortcuts.ts` are untouched by this. That is the
 * path for Space and the arrows; this is a second, narrower one for the four
 * keys whose entire purpose is to work while something else is in front.
 */
export const GLOBAL_MEDIA_KEYS: ReadonlyArray<{ accelerator: string; action: MediaKeyAction }> = [
  { accelerator: "MediaPlayPause", action: "toggle" },
  { accelerator: "MediaTrackNext", action: "next" },
  { accelerator: "MediaTrackPrevious", action: "previous" },
  { accelerator: "MediaStop", action: "stop" },
];

/** What the app needs from the global-shortcut plugin. */
export interface GlobalShortcutPorts {
  register: (accelerator: string, handler: () => void) => Promise<void>;
  unregister: (accelerator: string) => Promise<void>;
}

/**
 * Registers each media key, tolerating the ones already taken.
 *
 * **A failed registration is normal, not an error.** Another media player
 * holding `MediaPlayPause` makes `register` reject, and the honest response is
 * to carry on without that key: the user has two media players installed,
 * which is not a fault condition and not worth a banner over their library.
 *
 * Registers one at a time rather than as a batch so one taken key does not
 * cost the other three - the plugin's array form is all-or-nothing.
 *
 * Resolves to the accelerators that were actually claimed, which is what the
 * caller needs in order to release exactly those on exit.
 */
export async function registerMediaKeys(
  ports: GlobalShortcutPorts,
  run: (action: MediaKeyAction) => void,
): Promise<string[]> {
  const claimed: string[] = [];
  for (const { accelerator, action } of GLOBAL_MEDIA_KEYS) {
    try {
      await ports.register(accelerator, () => run(action));
      claimed.push(accelerator);
    } catch {
      // Taken by another application. Nothing to say and nothing to fix.
    }
  }
  return claimed;
}

/**
 * Releases the keys this app claimed.
 *
 * Failures are swallowed for the same reason they are on the way in, and
 * because this runs during teardown: throwing there would be noise at the
 * least useful moment. Leaving a key registered after exit would have the OS
 * routing it to nothing.
 */
export async function unregisterMediaKeys(
  ports: GlobalShortcutPorts,
  accelerators: readonly string[],
): Promise<void> {
  for (const accelerator of accelerators) {
    try {
      await ports.unregister(accelerator);
    } catch {
      // Already gone, or never ours.
    }
  }
}
