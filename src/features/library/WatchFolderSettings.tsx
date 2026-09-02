import { useEffect, useState } from "react";
import {
  listWatchFolders,
  loadWatchInterval,
  removeWatchFolder,
  saveWatchInterval,
} from "../../ipc";
import { report } from "../shell/statusStore";

/**
 * The intervals on offer, off first. Minutes, mirroring `settings::WATCH_INTERVALS`.
 *
 * A fixed set rather than a number box: this is how often the app walks the
 * library on its own, and the difference between the five is a preference
 * while the values between them are not.
 */
const WATCH_INTERVALS = [0, 5, 15, 30, 60] as const;

function intervalLabel(minutes: number): string {
  if (minutes === 0) {
    return "Never";
  }
  return minutes === 60 ? "Every hour" : `Every ${minutes} minutes`;
}

/**
 * The watch folders and how often they are looked at.
 *
 * Nothing listed them before: "Add Folders…" put them in and there was no way
 * to see or take one out, which was survivable only while a folder did nothing
 * between scans. One that is re-walked on a timer needs both.
 *
 * Its own component rather than more rows in `SettingsDialog` because it holds
 * state - and local state rather than a store, since the dialog is mounted
 * when it opens: there is nothing to keep in step with while it is closed, and
 * a store would be a subscription the shell pays for on every launch.
 */
export function WatchFolderSettings() {
  const [folders, setFolders] = useState<string[] | null>(null);
  const [minutes, setMinutes] = useState(15);

  useEffect(() => {
    void (async () => {
      try {
        const [watched, stored] = await Promise.all([listWatchFolders(), loadWatchInterval()]);
        setFolders(watched);
        setMinutes(stored);
      } catch (cause) {
        report(cause);
      }
    })();
  }, []);

  const changeInterval = async (next: number) => {
    // Set locally first, so the select answers the click rather than the round
    // trip; there is nothing to reconcile if the write fails, and the thread
    // reads the stored value on its next wake either way.
    setMinutes(next);
    try {
      await saveWatchInterval(next);
    } catch (cause) {
      report(cause);
    }
  };

  const remove = async (path: string) => {
    try {
      await removeWatchFolder(path);
      setFolders((current) => (current ?? []).filter((folder) => folder !== path));
    } catch (cause) {
      report(cause);
    }
  };

  return (
    <section className="settings-watch">
      <h3>Music Folders</h3>

      <div className="settings-row">
        <label htmlFor="watch-interval">Check For Changes</label>
        <select
          id="watch-interval"
          value={minutes}
          onChange={(event) => void changeInterval(Number(event.target.value))}
        >
          {WATCH_INTERVALS.map((option) => (
            <option key={option} value={option}>
              {intervalLabel(option)}
            </option>
          ))}
        </select>
      </div>

      {/* Null while the list is still being read: an empty list and an
          unanswered one look the same, and only one of them is worth a
          sentence saying there is nothing here. */}
      {folders === null ? null : folders.length === 0 ? (
        <p className="settings-watch-note">
          Nothing is being watched. Add a folder with File ▸ Add Folders…
        </p>
      ) : (
        <ul className="settings-folders">
          {folders.map((folder) => (
            <li key={folder}>
              {/* The whole path in the tooltip, since the row truncates it. */}
              <span title={folder}>{folder}</span>
              <button
                type="button"
                aria-label={`Stop watching ${folder}`}
                onClick={() => void remove(folder)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="settings-watch-note">
        Removing a folder only stops it being looked at. The songs already in your library stay
        until a check finds their files gone, and are then marked missing.
      </p>
    </section>
  );
}
