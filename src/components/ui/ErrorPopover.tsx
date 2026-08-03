import { Popover } from "@base-ui/react/popover";
import type React from "react";

/**
 * What went wrong, pointing at the thing it went wrong with.
 *
 * This was a paragraph above the table, which had two problems: it pushed the
 * rows down as it appeared and shifted the whole view under the pointer, and it
 * sat nowhere near what it was about. A popover anchored to the status display
 * costs no layout and says, by where it is, that the message concerns playback.
 *
 * It does **not** take focus. An error arrives unasked - usually mid-scroll or
 * mid-selection - and a notice that grabs the caret to tell you something is a
 * notice that interrupts what you were doing. Escape and the close button
 * dismiss it; it needs no focus for either.
 */
export function ErrorPopover({
  message,
  anchor,
  onDismiss,
}: {
  /** The message, or null when there is nothing wrong. */
  message: string | null;
  /** What the popover points at - the status display, in practice. */
  anchor: React.RefObject<HTMLElement | null>;
  onDismiss: () => void;
}) {
  return (
    <Popover.Root
      open={message !== null}
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          className="error-positioner"
          anchor={anchor}
          side="bottom"
          align="center"
          sideOffset={8}
        >
          {/* `role="alert"` so it is announced when it appears rather than only
              when something reaches it - which nothing will, since it never
              takes focus. */}
          <Popover.Popup className="error-popup" role="alert" initialFocus={false}>
            <span className="error-text">{message}</span>
            <Popover.Close
              className="error-dismiss"
              render={<button type="button" aria-label="Dismiss error" />}
            >
              ✕
            </Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
