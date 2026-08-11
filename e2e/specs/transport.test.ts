import { browser, expect } from "@wdio/globals";
import { invoke } from "../invoke";
import { capture } from "../screenshot";

/**
 * Mute and repeat-one, in the app that owns them.
 *
 * Both are backend state reached through a button, and the half no component
 * test can see is the round trip: `chrome.test.tsx` proves the button reports
 * a click and draws its pressed state against props a test supplies, and
 * `store.test.ts` proves the command is sent - neither says the player ever
 * hears it, nor that what comes back on `player://state` is what went out.
 *
 * A reload is how a spec reaches "the window opened again" without restarting
 * the process, the same trick the sidebar and crash specs use. Note what that
 * does and does not prove: the player thread outlives a webview reload, so
 * what is asserted after one is that the controls take their state from the
 * backend rather than from a default. That mute *reaches SQLite*, and what a
 * genuinely fresh process reads back out of it, is `settings::muted` and its
 * Rust tests - a spec cannot restart the app it is driving.
 *
 * Needs no songs, so it runs before the library is seeded.
 */

function muteButton() {
  return browser.$(".volume-mark");
}

function repeatButton() {
  return browser.$(".repeat-button");
}

async function waitForTheApp(): Promise<void> {
  await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
    timeout: 30_000,
    interval: 250,
  });
  await browser.$(".transport-strip").waitForExist({ timeout: 30_000 });
}

/** What the player itself says, which is the thing the buttons are drawing. */
function snapshot(): Promise<{ volume: number; muted: boolean; repeatOne: boolean }> {
  return invoke("player_snapshot");
}

/**
 * Puts a toggle into the state a test needs, whatever state it is in.
 *
 * These specs share one app process, so a test that failed halfway leaves the
 * transport however it got to, and the next one asserting from a guessed
 * starting point fails as a puzzle rather than as itself.
 */
async function setPressed(button: ReturnType<typeof muteButton>, pressed: boolean): Promise<void> {
  if ((await button.getAttribute("aria-pressed")) !== String(pressed)) {
    await button.click();
  }
}

describe("mute and repeat", () => {
  before(async () => {
    await waitForTheApp();
  });

  after(async () => {
    // Whatever this spec did, the next one starts with an audible player that
    // advances its queue - which is what every spec after it assumes.
    await setPressed(muteButton(), false);
    await setPressed(repeatButton(), false);
  });

  it("mutes and unmutes without forgetting the level", async () => {
    await setPressed(muteButton(), false);
    const before = await snapshot();

    await muteButton().click();

    await expect(muteButton()).toHaveAttribute("aria-pressed", "true");
    await browser.waitUntil(async () => (await snapshot()).muted, {
      timeout: 10_000,
      timeoutMsg: "the player never reported itself muted",
    });
    // The whole point of mute being its own state: the level is untouched, so
    // there is something to come back to.
    expect((await snapshot()).volume).toBe(before.volume);
    // And the rail on screen still shows it rather than dropping to zero.
    // Either the ARIA value or the input's own, because which of the two the
    // slider part carries is Base UI's business rather than this suite's.
    const shown = await browser.execute(() => {
      const rail = document.querySelector(".volume-slider [role='slider']");
      return rail === null
        ? ""
        : (rail.getAttribute("aria-valuenow") ?? (rail as HTMLInputElement).value ?? "");
    });
    expect(shown).toBe(String(Math.round(before.volume * 100)));

    await muteButton().click();

    await expect(muteButton()).toHaveAttribute("aria-pressed", "false");
    await browser.waitUntil(async () => !(await snapshot()).muted, { timeout: 10_000 });
    expect((await snapshot()).volume).toBe(before.volume);
  });

  it("turns repeat on and off", async () => {
    await setPressed(repeatButton(), false);

    await repeatButton().click();

    await expect(repeatButton()).toHaveAttribute("aria-pressed", "true");
    await browser.waitUntil(async () => (await snapshot()).repeatOne, {
      timeout: 10_000,
      timeoutMsg: "the player never reported repeat on",
    });

    await capture("transport-mute-repeat");

    await repeatButton().click();
    await browser.waitUntil(async () => !(await snapshot()).repeatOne, { timeout: 10_000 });
  });

  it("draws what the player holds when the window comes back", async () => {
    // One on and one off, so what comes back can be told apart from a blanket
    // default in either direction.
    await setPressed(muteButton(), true);
    await setPressed(repeatButton(), false);
    await browser.waitUntil(async () => (await snapshot()).muted, { timeout: 10_000 });

    await browser.refresh();
    await waitForTheApp();

    await expect(muteButton()).toHaveAttribute("aria-pressed", "true");
    await expect(repeatButton()).toHaveAttribute("aria-pressed", "false");
  });
});
