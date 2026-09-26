import { useRef } from "react";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from "../primitives/Dialog";

/**
 * What went wrong, for anything reported through the status channel.
 *
 * A dialog rather than the popover it replaced, which pointed at the
 * now-playing box: the player bar goes away while nothing is loaded, and a
 * failed load is exactly the moment it does, so there was nothing left to
 * point at.
 *
 * `role="alert"` so a stray click on the backdrop does not clear it unread;
 * Escape and OK both do.
 */
export function ErrorDialog({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const okRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog role="alert" variant="error" initialFocus={okRef} onClose={onDismiss}>
      {/* A heading, because the message alone is often a path and a reason
          with no subject: "C:/music/gone.mp3 could not be opened" does not say
          on its own that the app is reporting a fault. */}
      <DialogHeader title="Something went wrong" />
      <DialogBody>
        <DialogDescription>{message}</DialogDescription>
      </DialogBody>
      <DialogFooter>
        <DialogClose kind="primary" ref={okRef}>
          OK
        </DialogClose>
      </DialogFooter>
    </Dialog>
  );
}
