import type { Track } from "../../ipc";
import { rowStatus, STATUS_COLUMN_WIDTH } from "./rowStatus";

/**
 * The row's fixed first cell: playing, missing, or nothing.
 *
 * An icon is not a label, so each state carries text only a screen reader
 * sees. The missing state also carries the path in a `title`, because "why is
 * this one red" is the immediate question and the answer is which file.
 *
 * Colour is never the only signal: the exclamation mark carries the meaning on
 * its own for anyone who cannot tell the red from the surrounding text.
 */
export function RowStatusCell({
  track,
  nowPlayingId,
}: {
  track: Track | null;
  nowPlayingId: number | null;
}) {
  const status = track === null ? null : rowStatus(track, nowPlayingId);

  return (
    <td className="song-cell status" style={{ width: STATUS_COLUMN_WIDTH }}>
      {status === "playing" ? (
        <span className="row-status playing">
          <SpeakerIcon />
          <span className="visually-hidden">Playing</span>
        </span>
      ) : status === "missing" ? (
        <span className="row-status missing" title={track?.path}>
          <span aria-hidden="true">!</span>
          <span className="visually-hidden">File missing</span>
        </span>
      ) : null}
    </td>
  );
}

/**
 * A speaker with two sound waves that pulse.
 *
 * The deliberate exception to phase 13's no-animation rule: here the motion
 * *is* the state - it is what distinguishes the row that is playing from the
 * row that is merely selected - rather than decoration on a state change. It
 * stops under `prefers-reduced-motion`, where the static speaker still says
 * everything the row needs to.
 */
function SpeakerIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M1 6h3l4-3.5v11L4 10H1z" fill="currentColor" />
      <path className="wave near" d="M10 5.5a4 4 0 0 1 0 5" fill="none" stroke="currentColor" />
      <path className="wave far" d="M12 3.5a7 7 0 0 1 0 9" fill="none" stroke="currentColor" />
    </svg>
  );
}
