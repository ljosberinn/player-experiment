import { useEffect, useState } from "react";
import { acknowledgeCrash, type CrashReport, lastCrash, revealCrashLog } from "../../ipc";

/**
 * Tells the user the app crashed last time, once.
 *
 * A panic takes the process down before any JavaScript could run, so the only
 * moment this can be said is the *next* launch - which is why it is asked for
 * once on mount rather than subscribed to. A crash that has already happened
 * cannot happen again while the app is up.
 *
 * Dismissing it records which crash was seen, so the notice belongs to that
 * crash rather than to the session: closing it does not hide the next one, and
 * not closing it does not mean being told about the same one forever.
 */
export function CrashNotice() {
  const [report, setReport] = useState<CrashReport | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Failure here is silence, deliberately: a crash notice that could not be
    // read is not itself worth an error banner on a launch that is otherwise
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
      // Already hidden for this session. The worst case is being told once
      // more on the next launch, which is better than a dialog about failing
      // to dismiss a notice.
    }
  };

  return (
    <div className="crash-notice" role="status">
      <div className="crash-notice-body">
        <strong>The app closed unexpectedly last time.</strong>{" "}
        <span className="crash-notice-summary">{report.summary}</span>
      </div>

      {expanded ? (
        // `<pre>`, because a backtrace is a column of frames and reflowing it
        // makes it unreadable. It scrolls inside its own box rather than
        // pushing the table off the bottom of a window that does not scroll.
        <pre className="crash-notice-details">{report.details}</pre>
      ) : null}

      {error ? <span className="content-error">{error}</span> : null}

      <div className="crash-notice-actions">
        <button type="button" className="link-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Hide details" : "Show details"}
        </button>
        {/* The route to the *older* reports: the log keeps the last five and
            only the most recent is ever shown here. */}
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
        <button type="button" onClick={() => void dismiss()}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
