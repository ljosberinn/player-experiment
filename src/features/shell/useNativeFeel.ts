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
 * The two ways a webview behaves like a document rather than an application.
 *
 * Both are suppressed at the window rather than per element, so they cover the
 * chrome, the empty space, and anything added later without each one having to
 * remember. Handlers that want the browser behaviour, or that are a real drop
 * target, have already said so with `preventDefault` by the time these run.
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

  useEffect(() => {
    // A file dropped anywhere that does not handle it is *opened* by the
    // webview, which navigates the window away from the app and leaves nothing
    // but a relaunch. Cheap to hit now that the tag editor invites images onto
    // a 120px square.
    //
    // Only drags nothing accepted are swallowed: `defaultPrevented` is a real
    // drop target having already claimed this one, and `dropEffect = "none"`
    // keeps the pointer honest everywhere else instead of making the whole
    // window look droppable.
    const onDrag = (event: DragEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "none";
      }
    };
    window.addEventListener("dragover", onDrag);
    window.addEventListener("drop", onDrag);
    return () => {
      window.removeEventListener("dragover", onDrag);
      window.removeEventListener("drop", onDrag);
    };
  }, []);
}
