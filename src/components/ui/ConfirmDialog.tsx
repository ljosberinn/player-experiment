import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useEffect, useRef } from "react";

/**
 * A yes/no dialog for an action that cannot be undone.
 *
 * `AlertDialog` rather than `Dialog`, which is the role this component's own
 * prose already claimed: an alert dialog cannot be dismissed by clicking the
 * backdrop, which is the behaviour the hand-rolled version implemented by
 * simply not listening for it.
 *
 * Still deliberately not the OS message box. Tauri's `dialog.ask` is a separate
 * ACL-gated plugin call, looks nothing like the rest of the window, and cannot
 * carry the app's wording. What Base UI adds is the part that was missing: a
 * real focus trap, and a background made inert while the question stands.
 *
 * Cancel takes focus, not Confirm. Someone who hits Enter or Space by reflex on
 * a dialog they did not expect should not thereby destroy something.
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

  // Claimed again on the next frame, not only through `initialFocus`. Every
  // route into this dialog runs through a context menu, and a menu returns
  // focus to its trigger as it unmounts - which happens after the dialog has
  // taken focus, so the sidebar row ends up focused behind an open dialog and
  // Enter reopens the thing you were asked about.
  useEffect(() => {
    const frame = requestAnimationFrame(() => cancelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    // Open from the moment it is rendered: the caller decides whether the
    // question is being asked, so there is no trigger and no internal state.
    // A close from anywhere - Escape, Cancel - is the caller's `onCancel`.
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="modal-backdrop" />
        <AlertDialog.Popup className="modal confirm" initialFocus={cancelRef}>
          {/* biome-ignore lint/a11y/useHeadingContent: the heading's content is this component's children, which Base UI puts inside the rendered <h2> - the rule only sees the empty element literal. */}
          <AlertDialog.Title render={<h2 />}>{title}</AlertDialog.Title>
          <AlertDialog.Description className="modal-summary">{body}</AlertDialog.Description>
          <div className="modal-actions">
            {/* The ref goes on the rendered element rather than on the part:
                `initialFocus` reads it while the popup is opening, and it has
                to be pointing at the button by then. */}
            <AlertDialog.Close render={<button type="button" ref={cancelRef} />}>
              Cancel
            </AlertDialog.Close>
            <button type="button" className="destructive" onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
