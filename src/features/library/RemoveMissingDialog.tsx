import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { useLibraryStore } from "./store";

/**
 * The confirmation in front of removing every song whose file has gone.
 *
 * Worth confirming because it is not undoable and reaches further than the
 * library: a removed song leaves every playlist it was in.
 */
export function RemoveMissingDialog({
  onClose,
  onRemoved,
}: {
  onClose: () => void;
  /** Reports how many went, once they have; the shell is what says so. */
  onRemoved: (removed: number) => void;
}) {
  const missing = useLibraryStore((s) => s.stats.missing);
  const removeMissing = useLibraryStore((s) => s.removeMissing);

  return (
    <ConfirmDialog
      title="Remove missing songs?"
      body={`${missing} song${missing === 1 ? "" : "s"} cannot be found on disk. Removing them takes them out of every playlist too. The files themselves are not touched - if a drive is simply unplugged, plug it back in and rescan instead.`}
      confirmLabel="Remove"
      onConfirm={() => {
        // Closed before the removal rather than after it: the answer has been
        // given, and a dialog that lingers through the write reads as one that
        // did not take the click.
        onClose();
        void removeMissing().then(onRemoved);
      }}
      onCancel={onClose}
    />
  );
}
