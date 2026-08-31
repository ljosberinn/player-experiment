import { useLibraryStore } from "../library/store";
import { useUpdaterStore } from "../updater/store";
import { viewSummary } from "./viewSummary";
import { formatZoom, MAX_ZOOM, MIN_ZOOM } from "./zoom";
import { useZoomStore } from "./zoomStore";

/** The strip along the bottom: zoom, what is on screen, and any update. */
export function StatusBar() {
  const zoomFactor = useZoomStore((s) => s.factor);
  const stepZoom = useZoomStore((s) => s.step);
  const tab = useLibraryStore((s) => s.tab);
  const browse = useLibraryStore((s) => s.browse);
  // Only for the count of how many albums, artists or genres a browse view is
  // listing; the view itself reads them for rendering.
  const groups = useLibraryStore((s) => s.groups);
  const stats = useLibraryStore((s) => s.stats);

  return (
    <footer className="statusbar">
      {/* First in the DOM as well as leftmost on screen. Grid auto-placement
          only moves forward, so an item explicitly assigned to column 1 after
          one sitting in column 2 cannot go back and starts a new row - which
          put the version and this control on a second line. */}
      {/* Bottom-left, in the strip's quietest corner: a control touched once
          and then left alone. Two buttons rather than a slider - the steps are
          0.1 apart over a narrow range, which is a worse fit for dragging than
          for clicking, and the two buttons are the same gesture as the
          Ctrl+plus / Ctrl+minus that already work. */}
      <span className="statusbar-zoom">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={zoomFactor <= MIN_ZOOM}
          onClick={() => void stepZoom(-1)}
        >
          −
        </button>
        {/* aria-live so a screen reader hears the new value; the buttons
            themselves keep their own labels rather than announcing it. */}
        <span className="statusbar-zoom-value" aria-live="polite">
          {formatZoom(zoomFactor)}
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={zoomFactor >= MAX_ZOOM}
          onClick={() => void stepZoom(1)}
        >
          +
        </button>
      </span>

      {/* What the Songs heading used to carry, for every view. Scoped to what
          is on screen rather than to the whole library: inside a playlist, a
          search or an album, a line under the table that counted something
          else would be answering a question nobody asked. */}
      <span className="statusbar-summary">
        {viewSummary({
          tab,
          drilledIn: browse !== null,
          groupCount: groups.length,
          trackCount: stats.tracks,
          durationMs: stats.durationMs,
          bytes: stats.bytes,
        })}
      </span>

      <UpdateButton />
    </footer>
  );
}

/**
 * The corner that is empty on all but a handful of launches.
 *
 * Only `ready` says anything. Checking and downloading happen quietly, and a
 * failed check usually means the machine is offline, which is not news.
 *
 * It is also the only way an update is ever applied: installing ends the
 * process and starts the installer, so a player that did it on a timer would
 * stop mid-song. Pressing this is the consent.
 */
function UpdateButton() {
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const install = useUpdaterStore((s) => s.install);

  if (status !== "ready" && status !== "installing") {
    return null;
  }
  return (
    <button
      type="button"
      className="statusbar-update"
      disabled={status === "installing"}
      onClick={() => void install()}
    >
      {status === "installing" ? "Installing…" : `${version} ready — restart to install`}
    </button>
  );
}
