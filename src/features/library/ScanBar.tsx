import { useEffect } from "react";
import { useScanStore } from "./scan";

/**
 * What a scan in progress looks like.
 *
 * Only the readout since phase 34. Add Folder and Rescan were buttons here
 * until the File menu gave them a home; what is left reports rather than acts,
 * which is why it stays on the content header instead of moving into a menu -
 * a menu that has to be open to tell you a scan is running is no use.
 *
 * Errors are not shown here either. They go to the one error popover the app
 * has, alongside the four other stores that can fail, rather than appearing as
 * a fifth kind of message in a fifth place.
 */
export function ScanBar() {
  const progress = useScanStore((s) => s.progress);
  const watch = useScanStore((s) => s.watch);

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

  if (progress === null || progress.done) {
    return null;
  }

  return (
    <span className="scan-progress" role="status">
      Scanning {progress.scanned.toLocaleString()} of {progress.total.toLocaleString()}
    </span>
  );
}
