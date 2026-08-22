import { useEffect } from "react";
import type { WriteProgress } from "../../ipc";
import { useEditorStore } from "../editor/store";
import { useExportStore } from "../export/store";

/**
 * What a long write in progress looks like, for the ones with no dialog.
 *
 * Beside `ScanBar` and shaped like it: a scan, an export and a tag undo are
 * the three things that can hold the app for a minute, and a readout that
 * appears somewhere different each time is three things to find rather than
 * one place to look.
 *
 * A tag *save* is deliberately not here. Its dialog is already on screen and
 * stays open while the write runs, so the progress belongs in it - putting it
 * behind the modal instead would be reporting from a place the user cannot see.
 */
export function TaskProgress() {
  const exportProgress = useExportStore((s) => s.progress);
  const exporting = useExportStore((s) => s.busy);
  const watchExport = useExportStore((s) => s.watch);

  const editorProgress = useEditorStore((s) => s.progress);
  // An undo is a write with no dialog; a save has one, and reports there.
  const undoing = useEditorStore((s) => s.tracks) === null && editorProgress !== null;
  const watchTags = useEditorStore((s) => s.watch);

  useEffect(() => {
    // Each `watch` resolves to its own teardown, which may land after unmount.
    let stop: (() => void)[] = [];
    let cancelled = false;
    void Promise.all([watchExport(), watchTags()]).then((offs) => {
      if (cancelled) {
        for (const off of offs) {
          off();
        }
      } else {
        stop = offs;
      }
    });
    return () => {
      cancelled = true;
      for (const off of stop) {
        off();
      }
    };
  }, [watchExport, watchTags]);

  if (exporting) {
    return <TaskLine verb="Exporting" progress={exportProgress} />;
  }
  if (undoing) {
    return <TaskLine verb="Reverting" progress={editorProgress} />;
  }
  return null;
}

/**
 * One line of progress, or just the verb.
 *
 * A total of zero is not a fraction worth drawing: an undo learns its size
 * from the backend, so there is a moment before the first event where the
 * honest thing to say is only that it is running.
 */
function TaskLine({ verb, progress }: { verb: string; progress: WriteProgress | null }) {
  return (
    <span className="scan-progress" role="status">
      {progress === null || progress.total === 0
        ? `${verb}…`
        : `${verb} ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`}
    </span>
  );
}
