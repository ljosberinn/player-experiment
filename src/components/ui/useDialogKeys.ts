import type React from "react";

/**
 * Enter to accept, Escape to abandon — for the app's dialogs.
 *
 * Both dialogs are a `div` with `role="dialog"` rather than `<dialog>`, so
 * neither gets these for free. A form that cannot be dismissed with Escape or
 * accepted with Enter reads as a web page, not an app.
 */
export function useDialogKeys({
  onAccept,
  onCancel,
  canAccept,
}: {
  onAccept: () => void;
  onCancel: () => void;
  /** When false, Enter does nothing rather than saving something invalid. */
  canAccept: boolean;
}) {
  return (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Enter") {
      return;
    }
    // Enter inside a button is that button's click, and inside a select it is
    // the dropdown's own business; hijacking either would break the control
    // the user is actually operating.
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA") {
      return;
    }
    if (!canAccept) {
      // Still swallowed: an Enter that silently does nothing is better than
      // one that submits the surrounding form and reloads the webview.
      event.preventDefault();
      return;
    }
    event.preventDefault();
    onAccept();
  };
}
