import { useEffect } from "react";
import type { WriteProgress } from "../../ipc";
import { useEditorStore } from "../editor/store";
import { useExportStore } from "../export/store";

/**
 * What a long write in progress looks like, for the ones with no dialog.
 *
 * Beside `ScanBar` and shaped like it: a scan and an export are what can hold
 * the app for a minute without a dialog of their own, and a readout that
 * appears somewhere different each time is two things to find rather than one
 * place to look.
 *
 * It also subscribes to `tags://progress` without drawing it. Every sender on
 * that channel reports in a dialog that is already on screen - a tag save in
 * the editor, the lookup's apply in its own - so this owns the subscription
 * that fills the editor store for the same reason `ScanBar` owns its own:
 * something mounted for the whole session has to, and putting it in the dialog
 * would mean subscribing as the write it reports on is already starting.
 */
export function TaskProgress() {
  const exportProgress = useExportStore((s) => s.progress);
  const exporting = useExportStore((s) => s.busy);
  const watchExport = useExportStore((s) => s.watch);

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
  return null;
}

/**
 * One line of progress, or just the verb.
 *
 * A total of zero is not a fraction worth drawing: there is a moment before the
 * first event where the honest thing to say is only that it is running.
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
