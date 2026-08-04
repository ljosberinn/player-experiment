import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useEffect, useRef, useState } from "react";
import { acknowledgeCrash, type CrashReport, lastCrash, revealCrashLog } from "../../ipc";

/**
 * Tells the user the app crashed last time, once.
 *
 * A panic takes the process down before any JavaScript could run, so the only
 * moment this can be said is the *next* launch - which is why it is asked for
 * once on mount rather than subscribed to. A crash that has already happened
 * cannot happen again while the app is up.
 *
 * `AlertDialog`, not a banner and not `Dialog`. The first draft was a strip
 * above the table, which is the wrong shape twice over: it sat where the scan
 * and tag notices sit, which describe the session that is *running*, and it
 * could be scrolled past - the wrong affordance for the one message that
 * reports the app having died. An alert dialog also cannot be dismissed by
 * clicking the backdrop, which is exactly the distinction Base UI draws
 * between `AlertDialog` and `Dialog`: the choice has to be made rather than
 * clicked away.
 *
 * Dismissing records *which* crash was seen, so the dialog belongs to that
 * crash rather than to the session: closing it does not hide the next one, and
 * not closing it does not mean being told about the same one forever.
 */
export function CrashNotice() {
  const [report, setReport] = useState<CrashReport | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Failure here is silence, deliberately: a crash notice that could not be
    // read is not itself worth an error dialog on a launch that is otherwise
    // fine.
    lastCrash().then(setReport, () => setReport(null));
  }, []);

  if (report === null) {
    return null;
  }

  const dismiss = async () => {
    setReport(null);
    try {
      await acknowledgeCrash(report.when);
    } catch {
      // Already closed for this session. The worst case is being told once
      // more on the next launch, which is better than a dialog about failing
      // to dismiss a dialog.
    }
  };

  return (
    // Open from the moment there is something to report: the report itself is
    // the state, so there is no trigger. Every route out - Escape, Dismiss -
    // is the same acknowledgement, because a crash the user has now read is a
    // crash the user has seen.
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          void dismiss();
        }
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="modal-backdrop" />
        <AlertDialog.Popup className="modal crash-notice" initialFocus={dismissRef}>
          {/* biome-ignore lint/a11y/useHeadingContent: the heading's content is this component's children, which Base UI puts inside the rendered <h2> - the rule only sees the empty element literal. */}
          <AlertDialog.Title render={<h2 />}>The app closed unexpectedly</AlertDialog.Title>

          <AlertDialog.Description className="modal-summary">
            It stopped last time with the error below. Nothing was sent anywhere - the report is on
            this machine only.
          </AlertDialog.Description>

          <p className="crash-notice-summary">{report.summary}</p>

          {expanded ? (
            // `<pre>`, because a backtrace is a column of frames and reflowing
            // it makes it unreadable. It scrolls inside its own box rather than
            // growing the dialog past the bottom of the window.
            <pre className="crash-notice-details">{report.details}</pre>
          ) : null}

          {error ? <p className="content-error">{error}</p> : null}

          <div className="modal-actions">
            <button type="button" className="link-button" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Hide details" : "Show details"}
            </button>
            {/* The route to the *older* reports: the log keeps the last five
                and only the most recent is ever shown here. */}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setError(null);
                revealCrashLog().catch((cause: unknown) => setError(String(cause)));
              }}
            >
              Show log file
            </button>
            {/* The ref goes on the rendered element rather than on the part:
                `initialFocus` reads it while the popup is opening, and it has
                to be pointing at the button by then. */}
            <button
              type="button"
              className="primary"
              ref={dismissRef}
              onClick={() => void dismiss()}
            >
              Dismiss
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
