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
 * two rows above it are one control each, and this is a control plus prose.
 */
export function LastfmSettings() {
  const configured = useLastfmStore((s) => s.configured);
  const username = useLastfmStore((s) => s.username);
  const connecting = useLastfmStore((s) => s.connecting);
  const error = useLastfmStore((s) => s.error);
  const connect = useLastfmStore((s) => s.connect);
  const cancelConnect = useLastfmStore((s) => s.cancelConnect);
  const disconnect = useLastfmStore((s) => s.disconnect);

  const connected = username !== null;

  return (
    <section className="settings-lastfm">
      <h3>last.fm</h3>

      <div className="settings-row">
        {/* `aria-live`, because the line changes underneath a user who is
            looking at their browser rather than at this dialog. */}
        <span className="settings-lastfm-status" aria-live="polite">
          {statusLine({ configured, username, connecting })}
        </span>

        {connected ? (
          <button type="button" onClick={() => void disconnect()}>
            Disconnect
          </button>
        ) : connecting ? (
          <button type="button" onClick={cancelConnect}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            // A build with no key has nothing to connect to, so the button
            // says so by being unavailable rather than by failing when pressed.
            disabled={!configured}
            onClick={() => void connect()}
          >
            Connect
          </button>
        )}
      </div>

      {error === null ? null : (
        <p className="settings-lastfm-error" role="alert">
          {error}
        </p>
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
