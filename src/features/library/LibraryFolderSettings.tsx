import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import {
  countTracks,
  defaultTrackQuery,
  loadLibraryFolder,
  saveOrganizeLibrary,
  setLibraryRoot,
} from "../../ipc";
import { report } from "../shell/statusStore";

/**
 * The Library folder: where songs are filed, and whether they are.
 *
 * Above `WatchFolderSettings` because it is the stronger statement of the same
 * thing — what the app does to the library while nobody is watching — and its
 * own component for that one's reason: it holds state, and local state rather
 * than a store since the dialog is mounted only while it is open.
 *
 * `onLockChange` is what the folder list below needs: the root is a watch
 * folder and cannot be removed while the filing is on, so that list has to
 * know which of its rows is this one. The two are siblings, and a value they
 * both read has to come from above them.
 */
export function LibraryFolderSettings({
  onLockChange,
}: {
  onLockChange: (root: string | null) => void;
}) {
  const [root, setRoot] = useState<string | null>(null);
  const [organize, setOrganize] = useState(false);
  /** A folder the picker refused, said where the choice was made. */
  const [problem, setProblem] = useState<string | null>(null);
  /** The folder awaiting confirmation, and what saying yes will cost. */
  const [pending, setPending] = useState<{ path: string; songs: number } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const folder = await loadLibraryFolder();
        setRoot(folder.root);
        setOrganize(folder.organize);
        onLockChange(folder.organize ? folder.root : null);
      } catch (cause) {
        report(cause);
      }
    })();
  }, [onLockChange]);

  const changeOrganize = async (next: boolean) => {
    // Set locally first, so the checkbox answers the click rather than the
    // round trip; the pass reads the stored value on its next tick either way.
    setOrganize(next);
    onLockChange(next ? root : null);
    try {
      await saveOrganizeLibrary(next);
    } catch (cause) {
      report(cause);
    }
  };

  /**
   * Asks for a folder, then asks whether it is worth what it costs.
   *
   * The confirmation belongs to the picker alone: every file in the library is
   * off its target the moment the root changes, so this is where the cost is
   * committed. Turning the checkbox on afterwards costs nothing this did not
   * already name.
   */
  const choose = async () => {
    setProblem(null);
    try {
      const picked = await open({ directory: true, title: "Choose your library folder" });
      if (typeof picked !== "string" || picked === root) {
        return;
      }
      setPending({ path: picked, songs: await countTracks(defaultTrackQuery) });
    } catch (cause) {
      report(cause);
    }
  };

  const commit = async (path: string) => {
    setPending(null);
    try {
      await setLibraryRoot(path);
      setRoot(path);
      onLockChange(organize ? path : null);
    } catch (cause) {
      // In the section rather than on the status bar: it is about the folder
      // the user has this moment chosen, and it is where they will choose
      // another one.
      setProblem(String(cause));
    }
  };

  return (
    <section className="settings-library">
      <h3>Library Folder</h3>

      <div className="settings-row">
        <span id="library-root-label">Folder</span>
        <span className="settings-library-root">
          {/* The whole path in the tooltip, since the row truncates it. */}
          <span title={root ?? undefined}>{root ?? "None chosen"}</span>
          <button type="button" aria-describedby="library-root-label" onClick={() => void choose()}>
            {root === null ? "Choose…" : "Change…"}
          </button>
        </span>
      </div>

      {/* A native checkbox rather than a Base UI switch, like the rows above:
          it is a plain on/off preference in a dialog. Disabled until there is
          a folder, so filing with nowhere to file to is not a state this can
          reach — the pass treats it as off in any case. */}
      <div className="settings-row">
        <label htmlFor="organize-library">Organise My Library</label>
        <input
          id="organize-library"
          type="checkbox"
          checked={organize}
          disabled={root === null}
          onChange={(event) => void changeOrganize(event.target.checked)}
        />
      </div>

      {problem === null ? null : <p className="settings-library-error">{problem}</p>}

      <p className="settings-library-note">
        Songs are moved into artist and album folders as the app works through them. Turning this
        off stops it; nothing moves back.
      </p>

      {pending === null ? null : (
        <ConfirmDialog
          title="Move your library?"
          body={`${pending.songs.toLocaleString()} ${
            pending.songs === 1 ? "song" : "songs"
          } will be moved into ${pending.path}, a few at a time in the background. Turning Organise My Library off stops it, but nothing moves back.`}
          confirmLabel="Move Songs"
          onConfirm={() => void commit(pending.path)}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
}
