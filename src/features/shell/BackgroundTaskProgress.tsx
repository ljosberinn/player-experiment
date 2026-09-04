import { useEffect } from "react";
import { useBackgroundTaskStore } from "./backgroundTaskStore";
import { taskSummary } from "./taskSummary";

/**
 * What a task measured in hours looks like, at the foot of the sidebar.
 *
 * Not `TaskProgress`, and it does not become it. That one sits on the content
 * header beside `ScanBar`, reads two per-write channels and reports on writes
 * that finish in a minute. This is a different place, a different lifetime and
 * a different shape - a percentage to two decimals and an estimate, standing
 * for the better part of two days - and folding them together would give one
 * component two homes.
 *
 * Mounted for the whole session, like `ScanBar`: it is what subscribes to the
 * channel, and it draws nothing at all while there is no task. It subscribes on
 * its own behalf rather than being handed a value, so a percentage that ticks
 * every twenty seconds re-renders a line and not the sidebar.
 */
export function BackgroundTaskProgress() {
  const task = useBackgroundTaskStore((s) => s.task);
  const watch = useBackgroundTaskStore((s) => s.watch);

  useEffect(() => {
    // `watch` resolves to its own teardown, which may land after unmount.
    let stop: (() => void) | undefined;
    let cancelled = false;
    void watch().then((off) => {
      if (cancelled) {
        off();
      } else {
        stop = off;
      }
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [watch]);

  if (task === null) {
    return null;
  }

  return (
    <p className="sidebar-task" role="status">
      {taskSummary(task)}
    </p>
  );
}
