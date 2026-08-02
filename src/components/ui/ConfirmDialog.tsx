import { useEffect, useRef } from "react";

/**
 * A yes/no dialog for an action that cannot be undone.
 *
 * Deliberately not the OS message box: Tauri's `dialog.ask` is a separate
 * ACL-gated plugin call, looks nothing like the rest of the window, and cannot
 * carry the app's wording. This reuses the same `.modal` chrome as the tag and
 * filter editors, so a destructive question does not arrive looking like it
 * came from somewhere else.
 *
 * Cancel takes focus, not Confirm. Someone who hits Enter or Space by reflex
 * on a dialog they did not expect should not thereby destroy something.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="modal-backdrop">
      {/* No click-outside dismissal, matching the other two dialogs: a
          destructive question should be answered, not waved away by a stray
          click on the backdrop. Escape and Cancel are the ways out. */}
      {/* The key handler is a dialog-level shortcut, not a control: everything
          focusable inside stays reachable and operable on its own. */}
      <div
        className="modal confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-body" className="modal-summary">
          {body}
        </p>
        <div className="modal-actions">
          <button type="button" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="destructive" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
