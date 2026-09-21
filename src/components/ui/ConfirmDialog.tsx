import { useEffect, useRef } from "react";
import { Button } from "../primitives/Button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from "../primitives/Dialog";

/**
 * A yes/no dialog for an action that cannot be undone.
 *
 * `role="alert"` rather than the ordinary dialog, which is the role this
 * component's own prose already claimed: an alert dialog cannot be dismissed
 * by clicking the backdrop, which is the behaviour the hand-rolled version
 * implemented by simply not listening for it.
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
    <Dialog role="alert" variant="confirm" initialFocus={cancelRef} onClose={onCancel}>
      <DialogHeader title={title} />
      <DialogBody>
        <DialogDescription>{body}</DialogDescription>
      </DialogBody>
      <DialogFooter>
        {/* The ref goes on the rendered button rather than on the part:
            `initialFocus` reads it while the popup is opening, and it has to
            be pointing at the element by then. */}
        <DialogClose ref={cancelRef}>Cancel</DialogClose>
        <Button kind="destructive" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
