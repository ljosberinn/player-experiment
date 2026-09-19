import { useEffect } from "react";

/**
 * True for somewhere the OS menu is genuinely useful.
 *
 * Text fields keep theirs: Cut/Copy/Paste, and on Windows the IME and
 * spell-check entries, are real functionality that the app does not reimplement
 * and should not take away.
 */
function wantsNativeMenu(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const field = target.closest("input, textarea");
  if (field === null) {
    return false;
  }
  // A range or checkbox is an input with nothing to paste into.
  return (
    !(field instanceof HTMLInputElement) || /^(text|search|url|email|number)$/.test(field.type)
  );
}

/**
 * The way a webview behaves like a document rather than an application.
 *
 * Suppressed at the window rather than per element, so it covers the chrome,
 * the empty space, and anything added later without each one having to
 * remember. Handlers that want the browser behaviour have already said so with
 * `preventDefault` by the time this runs.
 */
export function useNativeFeel(): void {
  useEffect(() => {
    // A desktop application does not offer "Reload" and "View Page Source" on
    // a song. The app's own menus call `preventDefault` first, so they open.
    const onContextMenu = (event: MouseEvent) => {
      if (wantsNativeMenu(event.target)) {
        return;
      }
      event.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);
}
