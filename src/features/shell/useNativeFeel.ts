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
 * Suppresses the webview's own context menu everywhere the app is not a
 * document.
 *
 * A desktop application does not offer "Reload" and "View Page Source" on a
 * song. Registered at the document rather than per element so it covers the
 * chrome, the empty space, and anything added later without each one having to
 * remember - the app's own menus call `preventDefault` in their own handlers
 * first, so they still open.
 */
export function useNativeFeel(): void {
  useEffect(() => {
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
