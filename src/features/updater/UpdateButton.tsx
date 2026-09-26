import { useUpdaterStore } from "./store";

/**
 * The offer to restart into a downloaded update, beside the version it
 * replaces. Only `ready` says anything: checking and downloading happen
 * quietly, and a failed check usually means the machine is offline.
 *
 * It is also the only way an update is ever applied: installing ends the
 * process and starts the installer, so a player that did it on a timer would
 * stop mid-song. Pressing this is the consent.
 */
export function UpdateButton() {
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const install = useUpdaterStore((s) => s.install);

  if (status !== "ready" && status !== "installing") {
    return null;
  }
  return (
    <button
      type="button"
      className="appbar-update"
      disabled={status === "installing"}
      onClick={() => void install()}
    >
      {status === "installing" ? "Installing…" : `${version} ready — restart to install`}
    </button>
  );
}
