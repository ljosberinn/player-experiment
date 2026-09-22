import { browser } from "@wdio/globals";
import { invoke } from "./invoke";

/**
 * Starting a song, and asking the player what it is doing.
 *
 * Shared because the route into playback is not a line of code anyone would
 * arrive at twice: activating a row takes a real click and a dispatched
 * double-click, for the reason `playRow` gives, and a spec that got it wrong
 * would fail as "no row is marked playing" with none of the diagnosis below.
 */

/** What the player itself says, which is the thing the controls are drawing. */
export function snapshot(): Promise<{
  status: "Stopped" | "Playing" | "Paused";
  track: { id: number; title: string } | null;
  queueIndex: number | null;
  queueLen: number;
  positionMs: number;
  durationMs: number;
  repeatOne: boolean;
}> {
  return invoke("player_snapshot");
}

/**
 * Ends the playing track as though it had run out.
 *
 * The e2e build plays a sink that never finishes on its own, deliberately, so
 * this is the only route to the two behaviours that happen at a track's end -
 * the queue advancing unasked, and repeat-one starting the same song again.
 * See `e2e_end_track` in `commands/mod.rs`.
 */
export function endTrack(): Promise<void> {
  return invoke("e2e_end_track");
}

/**
 * What the app thinks is playing, for a failure message.
 *
 * Built only when a wait has already failed. "No row is marked playing" has at
 * least four causes - the double-click never reached React, the command was
 * rejected, the file would not load, or the marker is not wired to the state -
 * and they are indistinguishable from the outside. Each of the four leaves a
 * different trace here.
 */
export async function describePlayback(): Promise<string> {
  const safe = async <T>(label: string, read: () => Promise<T>): Promise<string> => {
    try {
      return `${label}=${JSON.stringify(await read())}`;
    } catch (cause) {
      return `${label}=<threw ${String(cause)}>`;
    }
  };

  const parts = await Promise.all([
    // The backend's own answer: status, the track it holds, and how long the
    // queue is. A queue of zero means the command never arrived.
    safe("snapshot", () => invoke("player_snapshot")),
    // A load failure arrives on `player://error` and lands here. On a runner
    // that fell back to the shipped sink this reads "no audio output device",
    // which would mean the silent-sink variable never reached the app.
    safe("errorPopup", () =>
      browser.execute(() => document.querySelector(".error-popup")?.textContent ?? ""),
    ),
    safe("statusTitle", () =>
      browser.execute(() => document.querySelector(".now-playing-title")?.textContent ?? ""),
    ),
    // A selected row proves the double-click reached React at all: activating
    // a row selects it on the way past.
    safe("rowClasses", () =>
      browser.execute(() =>
        Array.from(document.querySelectorAll("tr.song-row")).map((one) => one.className),
      ),
    ),
  ]);

  return `no row is marked playing: ${parts.join(" ")}`;
}

/**
 * Plays row `index`, and waits for the marker.
 *
 * The click is real and the double-click is dispatched, which is not the
 * shape anyone would choose. `element.doubleClick()` goes through the Actions
 * API, and against this driver its two presses did not coalesce into a
 * `dblclick` at all: the diagnostic above reported the row *selected* - so the
 * click half had reached React - beside a backend whose queue was still empty.
 * The activation event simply never happened.
 *
 * Dispatching it is proven in `library.test.ts`, where a shift-click reaches
 * React's delegated handler the same way, and does so on CI. So the row is
 * clicked for real, which is what selects and focuses it, and then told to
 * activate.
 *
 * By `aria-rowindex` rather than by position in a `$$` result: the rows are
 * virtualized, so DOM order is not screen order.
 */
export async function playRow(index: number): Promise<void> {
  await browser.$(`tr.song-row[aria-rowindex='${index + 1}']`).click();
  await browser.execute((rowIndex: number) => {
    document
      .querySelector(`tr.song-row[aria-rowindex='${rowIndex}']`)
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }, index + 1);
  // The marker is not an optimistic flip in the store: it comes back on
  // `player://state` after the player thread has loaded the file the row
  // named, so waiting for it waits for the whole round trip.
  try {
    await browser.$("tr.song-row.playing").waitForExist({ timeout: 30_000 });
  } catch {
    // Built after the wait rather than before, so it reports the state at the
    // moment of failure.
    throw new Error(await describePlayback());
  }
}
