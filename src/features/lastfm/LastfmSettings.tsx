import { useState } from "react";
import { Button } from "../../components/primitives/Button";
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
          {queued === 1 ? "1 play is" : `${queued} plays are`} recorded and waiting to be sent. They
          go out with the next song, or the next time the app starts.
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

      <p className="settings-lastfm-note" aria-live="polite">
        {importLine({ importing, progress: importProgress, imported })}
      </p>
      {imported === null || importing ? null : (
        <div className="settings-row">
          <span className="settings-lastfm-note">
            Drops every imported play and fetches the history again.
          </span>
          <Button disabled={!canImport} onClick={() => void importHistory(importName, true)}>
            Re-import from Scratch
          </Button>
        </div>
      )}

      <p className="settings-lastfm-note">
        Connecting sends nothing but an API key — you sign in on last.fm’s own page, in your
        browser. After that, each song you play sends its artist, title, album, length and the time
        the play started. Never the file path, the folder name, the size of your library, or
        anything about this machine.
      </p>
      <p className="settings-lastfm-note">
        The key granting this access is stored unencrypted in your library database. Revoke it any
        time from your last.fm account settings; disconnecting here only forgets it locally.
      </p>
    </section>
  );
}

function sameAccount(imported: LastfmImport, name: string): boolean {
  return imported.username.toLowerCase() === name.toLowerCase();
}

/** What the line under the import row says. */
function importLine({
  importing,
  progress,
  imported,
}: {
  importing: boolean;
  progress: WriteProgress | null;
  imported: LastfmImport | null;
}): string {
  if (importing) {
    return progress === null || progress.total === 0
      ? "Importing…"
      : `Importing ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} scrobbles…`;
  }
  if (imported === null) {
    return "Brings your scrobbles into the play log. Needs a username, not a connection.";
  }
  if (imported.resumable) {
    return "The last import stopped part-way. Resume picks up where it stopped.";
  }
  if (imported.through === null) {
    return `${imported.username} has no scrobbles to import yet.`;
  }
  const through = new Date(imported.through * 1000).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
  return `Imported through ${through}. Import again to fetch what is newer.`;
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
    return "This build carries no last.fm key, so scrobbling is unavailable.";
  }
  if (username !== null) {
    return `Connected as ${username}.`;
  }
  if (connecting) {
    return "Waiting for you to allow access in your browser…";
  }
  return "Not connected. Nothing is sent.";
}
