import type { Play } from "../../../ipc";

/**
 * What one play row says, for Recent plays and On this day.
 *
 * The cells without the row: Recent plays places each row in a virtual
 * window and On this day lets them flow, so each list draws its own.
 */
export function PlayRowContent({ play, when }: { play: Play; when: string }) {
  return (
    <>
      <span className="plays-when">{when}</span>
      <span className="plays-title">{play.title}</span>
      <span className="plays-artist">{play.artist}</span>
      {/* Said rather than implied: a play with no file behind it is what the
          shopping list is made of. */}
      {play.trackId === null && <span className="plays-unowned">not owned</span>}
    </>
  );
}

/** The time of day a play started, as both lists write it. */
export function playTime(at: Date): string {
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
