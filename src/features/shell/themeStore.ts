import { create } from "zustand";
import { loadTheme, saveTheme } from "../../ipc";
import {
  DARK_QUERY,
  DEFAULT_THEME,
  type Ground,
  parseTheme,
  resolveTheme,
  type ThemePreference,
} from "./theme";

/**
 * What the store needs from the document to change the ground.
 *
 * A port rather than a direct reach for `document` and `matchMedia`, for the
 * same reason `ZoomPorts` exists: the tests have to be able to say what the OS
 * prefers, and jsdom's `matchMedia` is not implemented.
 */
export interface ThemePorts {
  /** Writes `data-theme` on `<html>`. */
  apply: (ground: Ground) => void;
  /** Whether the OS currently asks for a dark ground. */
  prefersDark: () => boolean;
  /**
   * Calls back when the OS preference changes, and returns an unsubscribe.
   *
   * Live rather than read once: "System" has to mean the OS *now*, and on
   * Windows the setting can change under a running app at sunset.
   */
  watch: (listener: () => void) => () => void;
}

export const documentTheme: ThemePorts = {
  apply: (ground) => {
    document.documentElement.setAttribute("data-theme", ground);
  },
  prefersDark: () => globalThis.matchMedia?.(DARK_QUERY).matches ?? false,
  watch: (listener) => {
    const query = globalThis.matchMedia?.(DARK_QUERY);
    query?.addEventListener("change", listener);
    return () => query?.removeEventListener("change", listener);
  },
};

interface ThemeState {
  /** What the user chose; "system" until they choose otherwise. */
  preference: ThemePreference;
  /** What that currently resolves to, and what `data-theme` says. */
  ground: Ground;
  /**
   * Reads the stored preference and applies it. Called before the window is
   * shown, so nobody watches the app change colour on every launch.
   */
  load: (ports?: ThemePorts) => Promise<void>;
  set: (preference: ThemePreference, ports?: ThemePorts) => Promise<void>;
  /** Re-resolves against the OS. Wired to the media query by `load`. */
  sync: (ports?: ThemePorts) => void;
}

/**
 * Which ground the app draws on.
 *
 * Its own store, and a very small one: `App.tsx` does not subscribe to it at
 * all. Nothing in React reads the ground - the attribute on `<html>` is what
 * the stylesheet keys off, so a theme change repaints without re-rendering a
 * single component, let alone a 150k-row table. Only the Settings dialog
 * subscribes, to draw the control.
 *
 * The initial `ground` is a placeholder that is overwritten by `load` before
 * the window is shown; `tokens.css` draws light for an attribute-less document
 * anyway, so the value here is never what anyone sees.
 */
export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: DEFAULT_THEME,
  ground: "light",

  load: async (ports = documentTheme) => {
    let preference = DEFAULT_THEME;
    try {
      preference = parseTheme(await loadTheme());
    } catch {
      // An unreadable setting is not worth blocking startup on: "system" is a
      // working app, and it is the default rather than a fallback.
    }
    const ground = resolveTheme(preference, ports.prefersDark());
    set({ preference, ground });
    ports.apply(ground);
    // Never torn down. The store outlives every component and the window, and
    // an unsubscribe would only matter if the app could stop having a theme.
    ports.watch(() => {
      get().sync(ports);
    });
  },

  set: async (preference, ports = documentTheme) => {
    if (preference === get().preference) {
      return;
    }
    const ground = resolveTheme(preference, ports.prefersDark());
    // Applied locally first, so the control answers the click rather than the
    // round trip.
    set({ preference, ground });
    ports.apply(ground);
    try {
      await saveTheme(preference);
    } catch {
      // Left showing what was asked for; the next change tries again.
    }
  },

  sync: (ports = documentTheme) => {
    const ground = resolveTheme(get().preference, ports.prefersDark());
    if (ground === get().ground) {
      return;
    }
    set({ ground });
    ports.apply(ground);
  },
}));
