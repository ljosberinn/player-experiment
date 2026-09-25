import { useState } from "react";
import { Button } from "../../components/primitives/Button";
import { TaskLine } from "../../components/primitives/TaskLine";
import type { LastfmImport, WriteProgress } from "../../ipc";
import { useLastfmStore } from "./store";

/**
 * The last.fm section of the Settings dialog.
 *
 * Says three things, in this order: whether an account is connected, the one
 * button that changes that, and **what actually leaves the machine**. The last
 * of those is not fine print — this is the product's first outbound network
 * dependency in an otherwise local-only player, and a user who installs a
 * local music player is entitled to know exactly what a scrobble carries
 * before turning it on.
 *
 * A `<section>` with its own heading rather than another `.settings-row`: the
 * row above it is one control, and this is a control plus prose.
 */
export function LastfmSettings() {
  const configured = useLastfmStore((s) => s.configured);
  const username = useLastfmStore((s) => s.username);
  const connecting = useLastfmStore((s) => s.connecting);
  const queued = useLastfmStore((s) => s.queued);
  const lovesQueued = useLastfmStore((s) => s.lovesQueued);
  const error = useLastfmStore((s) => s.error);
  const connect = useLastfmStore((s) => s.connect);
  const cancelConnect = useLastfmStore((s) => s.cancelConnect);
  const disconnect = useLastfmStore((s) => s.disconnect);
  const imported = useLastfmStore((s) => s.imported);
  const importing = useLastfmStore((s) => s.importing);
  const importProgress = useLastfmStore((s) => s.importProgress);
  const importHistory = useLastfmStore((s) => s.importHistory);
  // Null until typed in, so the field follows the account until the user
  // names a different one.
  const [draft, setDraft] = useState<string | null>(null);

  const connected = username !== null;
  const importName = (draft ?? imported?.username ?? username ?? "").trim();
  const canImport = configured && !importing && importName !== "";

  return (
    <section className="settings-lastfm">
      <h4>last.fm</h4>

      <div className="settings-row">
        {/* `aria-live`, because the line changes underneath a user who is
            looking at their browser rather than at this dialog. */}
        <span className="settings-lastfm-status" aria-live="polite">
          {statusLine({ configured, username, connecting })}
        </span>

        {/* Connect is a secondary like the rest: Done is the dialog's one
            primary. */}
        {connected ? (
          <Button onClick={() => void disconnect()}>Disconnect</Button>
        ) : connecting ? (
          <Button onClick={cancelConnect}>Cancel</Button>
        ) : (
          <Button
            // A build with no key has nothing to connect to, so the button
            // says so by being unavailable rather than by failing when pressed.
            disabled={!configured}
            onClick={() => void connect()}
          >
            Connect
          </Button>
        )}
      </div>

      {/* Only when there is a backlog, which in a healthy install is never.
          A line that says "0 waiting" is a line asking to be worried about. */}
      {queued === 0 ? null : (
        <p className="settings-lastfm-note" aria-live="polite">
          {queued === 1 ? "1 play" : `${queued} plays`} waiting to be sent.
        </p>
      )}
      {lovesQueued === 0 ? null : (
        <p className="settings-lastfm-note" aria-live="polite">
          {lovesQueued === 1 ? "1 love" : `${lovesQueued} loves`} waiting to be sent.
        </p>
      )}

      {error === null ? null : (
        <p className="settings-lastfm-error" role="alert">
          {error}
        </p>
      )}

      <div className="settings-row">
        <label htmlFor="lastfm-import-user">Import History</label>
        <span className="settings-lastfm-import">
          <input
            id="lastfm-import-user"
            type="text"
            spellCheck={false}
            placeholder="last.fm username"
            value={draft ?? imported?.username ?? username ?? ""}
            disabled={importing}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button disabled={!canImport} onClick={() => void importHistory(importName, false)}>
            {imported?.resumable && sameAccount(imported, importName) ? "Resume" : "Import"}
          </Button>
        </span>
      </div>

      {/* One live region for both, so the switch into a run is announced. */}
      <div aria-live="polite">
        {importing ? (
          <ImportRun progress={importProgress} />
        ) : (
          <p className="settings-lastfm-note">{importLine(imported)}</p>
        )}
      </div>
      {imported === null || importing ? null : (
        <div className="settings-row">
          <span className="settings-lastfm-note">Replaces every imported play.</span>
          <Button disabled={!canImport} onClick={() => void importHistory(importName, true)}>
            Re-import from Scratch
          </Button>
        </div>
      )}

      <p className="settings-lastfm-note">
        You sign in on last.fm, in your browser. A play sends its artist, title, album, length and
        start time; a love, its artist and title. Nothing else.
      </p>
      <p className="settings-lastfm-note">
        The access key is stored unencrypted. Disconnect only removes it here; revoke it in your
        last.fm settings.
      </p>
    </section>
  );
}

function sameAccount(imported: LastfmImport, name: string): boolean {
  return imported.username.toLowerCase() === name.toLowerCase();
}

/** A total of zero is the run before its first page, which knows only that it is running. */
function ImportRun({ progress }: { progress: WriteProgress | null }) {
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const headline =
    total === 0
      ? "Importing…"
      : `Importing ${done.toLocaleString()} of ${total.toLocaleString()} scrobbles…`;

  return <TaskLine headline={headline} estimate={null} ratio={total === 0 ? 0 : done / total} />;
}

/** What the line under the import row says between runs. */
function importLine(imported: LastfmImport | null): string {
  if (imported === null) {
    return "Imports any user’s scrobbles. No connection needed.";
  }
  if (imported.resumable) {
    return "The last import did not finish.";
  }
  if (imported.through === null) {
    return `${imported.username} has no scrobbles yet.`;
  }
  const through = new Date(imported.through * 1000).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
  return `Imported through ${through}.`;
}

/**
 * What the status line says.
 *
 * Four states and they are genuinely different: a build with no key cannot
 * connect at all, which is not the same as being disconnected, and a trip in
 * progress has to explain that the next move is in the browser.
 */
function statusLine({
  configured,
  username,
  connecting,
}: {
  configured: boolean;
  username: string | null;
  connecting: boolean;
}): string {
  if (!configured) {
    return "last.fm is not available in this build.";
  }
  if (username !== null) {
    return `Connected as ${username}.`;
  }
  if (connecting) {
    return "Waiting for you to allow access in your browser…";
  }
  return "Not connected. Nothing is sent.";
}
