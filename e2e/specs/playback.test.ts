import { browser, expect } from "@wdio/globals";
import { LIBRARY } from "../fixtures";
import { invoke } from "../invoke";
import { endTrack, playRow, snapshot } from "../playback";
import { capture } from "../screenshot";

/**
 * The queue, past the first note.
 *
 * `library.test.ts` starts a track and reads the marker off the row, and until
 * this spec that was the whole of playback in the suite: nothing had ever
 * pressed Next with a queue behind it, seen a pause, seen a track end, or moved
 * the playhead. Every one of those is a round trip to the player thread, and
 * the half no unit test can see is that the thread is on the other end of it -
 * `store.test.ts` proves the command is sent and `engine.rs`'s tests prove the
 * engine does the right thing with it, and between them nothing says the two
 * are wired together.
 *
 * Asserted against `player_snapshot` wherever the player is the subject.
 * `queueIndex` is what "Next moved the queue" actually means; the title in the
 * status display is how a user sees it, so both are read where both matter.
 *
 * The row order is read off the table rather than sorted into place. Every
 * assertion here is "the row after this one", which is true in whatever order
 * the spec before it left - and a sort of its own would be one more thing to
 * put back.
 *
 * Runs after `logfile.test.ts` and before `dynamic-background.test.ts`, which
 * plays its own tracks and stops the player when it is done - so what this
 * leaves behind reaches nothing that reads it. It stops the player anyway,
 * which is the state `shortcuts.test.ts` hands on and therefore the one every
 * spec between them has been written against.
 */

function playPause() {
  // Whichever it is showing: the label is the action the button offers, so it
  // is the assertion and cannot also be the selector.
  return browser.$("button[aria-label='Pause'], button[aria-label='Play']");
}

function repeatButton() {
  return browser.$(".repeat-button");
}

/** The hidden range input Base UI's slider puts the keyboard on. */
function seekInput() {
  return browser.$(".scrubber-track input[type='range']");
}

/** The titles on screen, in the order the table puts them. */
function rowTitles(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll("tr.song-row"))
      .sort(
        (a, b) =>
          Number(a.getAttribute("aria-rowindex") ?? 0) -
          Number(b.getAttribute("aria-rowindex") ?? 0),
      )
      .map((one) => one.querySelector("td.song-cell:not(.status)")?.textContent ?? ""),
  );
}

/** Waits for the player itself to report `index`, and says so if it never does. */
async function waitForQueueIndex(index: number): Promise<void> {
  await browser.waitUntil(async () => (await snapshot()).queueIndex === index, {
    timeout: 10_000,
    timeoutMsg: `the player never reached queue index ${index}`,
  });
}

/** Puts repeat into the state a test needs, whatever state it is in. */
async function setRepeat(on: boolean): Promise<void> {
  if ((await repeatButton().getAttribute("aria-pressed")) !== String(on)) {
    await repeatButton().click();
  }
  await browser.waitUntil(async () => (await snapshot()).repeatOne === on, {
    timeout: 10_000,
    timeoutMsg: `repeat never turned ${on ? "on" : "off"}`,
  });
}

/** Pauses, which is what freezes the playhead. */
async function pause(): Promise<void> {
  if ((await playPause().getAttribute("aria-label")) === "Pause") {
    await playPause().click();
  }
  await browser.waitUntil(async () => (await snapshot()).status === "Paused", {
    timeout: 10_000,
    timeoutMsg: "the player never reported itself paused",
  });
}

describe("a queue that is playing", () => {
  let titles: string[] = [];

  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
      timeout: 30_000,
      interval: 500,
    });
    // Songs, explicitly: the spec before this one leaves whatever view it was
    // looking at, and a row index means nothing anywhere else.
    await browser.$("//*[@class='sidebar-label'][text()='Songs']").click();
    await browser.waitUntil(async () => (await browser.$$("tr.song-row").length) > 0, {
      timeout: 30_000,
      timeoutMsg: "the shared library is empty - has the spec order changed?",
    });

    titles = await rowTitles();
  });

  after(async () => {
    // Stopped and repeat off, which is how `shortcuts.test.ts` leaves it and
    // therefore what every spec from there on has been given. Nothing
    // downstream reads it today, but a spec that walked away from a player it
    // had moved would be a puzzle the first time one did.
    await setRepeat(false);
    await invoke("player_stop");
  });

  it("moves through the queue with Next and Previous", async () => {
    await playRow(0);

    // The whole view is queued rather than the row that was activated, which is
    // what makes Next mean anything at all.
    const started = await snapshot();
    expect(started.queueIndex).toBe(0);
    expect(started.queueLen).toBe(LIBRARY.length);
    await expect(browser.$(".now-playing-title")).toHaveText(titles[0] ?? "");

    await browser.$("button[aria-label='Next']").click();

    await waitForQueueIndex(1);
    await expect(browser.$(".now-playing-title")).toHaveText(titles[1] ?? "");
    await expect(browser.$("tr.song-row.playing")).toHaveAttribute("aria-rowindex", "2");

    // The position is set rather than waited out, because the behaviour turns
    // on it: three seconds in, Previous restarts the track instead of stepping
    // back (`PREVIOUS_RESTART_AFTER`), and a driver racing the wall clock
    // across that line would pass or fail on how busy the runner was.
    await invoke("player_seek", { positionMs: 5_000 });

    await browser.$("button[aria-label='Previous']").click();

    await browser.waitUntil(async () => (await snapshot()).positionMs < 3_000, {
      timeout: 10_000,
      timeoutMsg: "Previous did not restart the track that was already playing",
    });
    expect((await snapshot()).queueIndex).toBe(1);

    await browser.$("button[aria-label='Previous']").click();

    await waitForQueueIndex(0);
    await expect(browser.$(".now-playing-title")).toHaveText(titles[0] ?? "");
  });

  it("starts the next track when one ends, without being asked", async () => {
    await playRow(0);
    await waitForQueueIndex(0);

    await endTrack();

    await waitForQueueIndex(1);
    expect((await snapshot()).status).toBe("Playing");
    await expect(browser.$(".now-playing-title")).toHaveText(titles[1] ?? "");
  });

  it("plays the same track again when it ends on repeat", async () => {
    await playRow(0);
    await waitForQueueIndex(0);
    await setRepeat(true);
    await invoke("player_seek", { positionMs: 5_000 });

    await endTrack();

    // `transport.test.ts` proves the flag reaches the player and comes back.
    // What it cannot prove is the thing the flag is for: that the end of a
    // track means this track again rather than the next one.
    await browser.waitUntil(async () => (await snapshot()).positionMs < 3_000, {
      timeout: 10_000,
      timeoutMsg: "the track on repeat never started again",
    });
    const looped = await snapshot();
    expect(looped.queueIndex).toBe(0);
    expect(looped.status).toBe("Playing");
    await expect(browser.$(".now-playing-title")).toHaveText(titles[0] ?? "");

    await setRepeat(false);
  });

  it("turns Play into Pause and back", async () => {
    await playRow(0);

    // Playing, so the button offers the other one.
    await expect(playPause()).toHaveAttribute("aria-label", "Pause");

    await pause();

    await expect(playPause()).toHaveAttribute("aria-label", "Play");

    await playPause().click();

    await browser.waitUntil(async () => (await snapshot()).status === "Playing", {
      timeout: 10_000,
      timeoutMsg: "the player never started again",
    });
    await expect(playPause()).toHaveAttribute("aria-label", "Pause");
  });

  it("moves the playhead from the scrubber", async () => {
    await playRow(0);

    // Paused first, and that is what makes the assertion an assertion: the
    // silent sink advances position on a wall clock, so against a playing
    // track "the position went up" is true whether or not the seek arrived.
    await pause();

    const before = (await snapshot()).positionMs;

    await browser.execute(() => {
      document.querySelector<HTMLInputElement>(".scrubber-track input[type='range']")?.focus();
    });
    await expect(seekInput()).toBeFocused();
    // One seek, not two: `targetOwns` stands the window-bound arrows down for a
    // focused rail, which is the rule `shortcuts.test.ts` drives from the
    // search box and this is the other side of.
    await browser.keys(["ArrowRight"]);

    await browser.waitUntil(async () => (await snapshot()).positionMs > before, {
      timeout: 10_000,
      timeoutMsg: "the scrubber did not move the playhead forward",
    });

    // The playhead somewhere other than the very start, which no photograph of
    // this app has ever shown.
    await capture("playback-mid-track");

    const forward = (await snapshot()).positionMs;

    await browser.keys(["ArrowLeft"]);

    await browser.waitUntil(async () => (await snapshot()).positionMs < forward, {
      timeout: 10_000,
      timeoutMsg: "the scrubber did not move the playhead back",
    });
  });
});
