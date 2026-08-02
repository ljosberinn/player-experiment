import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { addWatchFolder, onScanProgress, type ScanProgress, scanLibrary } from "../../ipc";
import { useLibraryStore } from "./store";

/**
 * Adding folders and running scans.
 *
 * Progress arrives as `scan://progress` events rather than by polling, and the
 * library refreshes once on completion - refreshing per event would re-query
 * the count hundreds of times during a large import.
 */
export function ScanBar() {
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useLibraryStore((s) => s.refresh);

  useEffect(() => {
    const unlisten = onScanProgress(setProgress);
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  const chooseFolder = async () => {
    setError(null);
    try {
      const selected = await open({ directory: true, multiple: false, title: "Add music folder" });
      if (typeof selected !== "string") {
        return;
      }
      await addWatchFolder(selected);
      await runScan();
    } catch (cause) {
      setError(String(cause));
    }
  };

  const runScan = async () => {
    setBusy(true);
    setError(null);
    try {
      await scanLibrary();
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="scanbar">
      <button type="button" onClick={() => void chooseFolder()} disabled={busy}>
        Add Folder…
      </button>
      <button type="button" onClick={() => void runScan()} disabled={busy}>
        {busy ? "Scanning…" : "Rescan"}
      </button>

      {progress && !progress.done ? (
        <span className="scan-progress" role="status">
          Scanning {progress.scanned.toLocaleString()} of {progress.total.toLocaleString()}
        </span>
      ) : null}

      {error ? (
        <span className="scan-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
