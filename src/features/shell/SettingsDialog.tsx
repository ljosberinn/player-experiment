import { Dialog } from "@base-ui/react/dialog";
import { formatZoom, MAX_ZOOM, MIN_ZOOM } from "./zoom";
import { useZoomStore } from "./zoomStore";

/**
 * Settings, reachable from Edit ▸ Settings…
 *
 * `Dialog` rather than `AlertDialog`: nothing here is a decision that cannot be
 * taken back, so clicking the backdrop to leave is the right way out. The
 * opposite choice - and the reason it is worth stating - is the crash notice,
 * which is an `AlertDialog` precisely because it must be acknowledged.
 *
 * Interface zoom is its only contents, and it is the same control the status
 * bar carries. That is deliberate rather than an oversight: the design puts
 * Settings in the Edit menu and the stepper in the corner, and both write the
 * same store. A setting reachable two ways is not a setting duplicated.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const factor = useZoomStore((s) => s.factor);
  const step = useZoomStore((s) => s.step);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup className="modal settings">
          {/* biome-ignore lint/a11y/useHeadingContent: the heading's content is this component's children, which Base UI puts inside the rendered <h2> - the rule only sees the empty element literal. */}
          <Dialog.Title render={<h2 />}>Settings</Dialog.Title>

          <div className="settings-row">
            <span>Interface Zoom</span>
            {/* No group label: each button already says what it does, and a
                plain span cannot carry one without inventing a role for it. */}
            <span className="statusbar-zoom">
              <button
                type="button"
                aria-label="Zoom out"
                disabled={factor <= MIN_ZOOM}
                onClick={() => void step(-1)}
              >
                −
              </button>
              <span className="statusbar-zoom-value" aria-live="polite">
                {formatZoom(factor)}
              </span>
              <button
                type="button"
                aria-label="Zoom in"
                disabled={factor >= MAX_ZOOM}
                onClick={() => void step(1)}
              >
                +
              </button>
            </span>
          </div>

          <div className="modal-actions">
            <Dialog.Close render={<button type="button" className="primary" />}>Done</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
