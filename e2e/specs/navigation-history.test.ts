import { browser, expect } from "@wdio/globals";
import { capture } from "../screenshot";

/**
 * Back and forward, through the sidebar's arrows.
 *
 * The store test proves the history itself - one refresh per navigation, the
 * derived sort, the columns reloaded only across a playlist boundary. What it
 * cannot reach is the pair of buttons: whether they are wired to the store at
 * all, and whether the disabled one is disabled in the engine that lays the
 * sidebar out rather than only in a jsdom attribute.
 *
 * Runs over an empty library, before anything seeds one: switching between
 * Songs and Releases needs no songs, and the arrows do not care what is in
 * the view they move between.
 */

const BACK = "button[aria-label='Back']";
const FORWARD = "button[aria-label='Forward']";

/** A library view in the sidebar, by its visible name. */
function view(name: string) {
  return browser.$(`//button[contains(@class,'sidebar-item')][normalize-space()='${name}']`);
}

async function waitForTheApp(): Promise<void> {
  await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
    timeout: 30_000,
    interval: 250,
  });
  await browser.$(".statusbar-summary").waitForExist({ timeout: 30_000 });
}

describe("back and forward", () => {
  before(async () => {
    // A reload rather than a guessed starting point: the specs share one app
    // process, so whatever ran before this has already navigated somewhere.
    await browser.refresh();
    await waitForTheApp();
  });

  after(async () => {
    // The specs after this one expect the library views, not a browse tab.
    await view("Songs").click();
    await expect(view("Songs")).toHaveAttribute("aria-current", "page");
  });

  it("offers neither direction when the app has just opened", async () => {
    await expect(browser.$(BACK)).toBeDisabled();
    await expect(browser.$(FORWARD)).toBeDisabled();

    await capture("history-nav-empty");
  });

  it("goes back to the view that was open before, and names it first", async () => {
    await view("Releases").click();
    await expect(view("Releases")).toHaveAttribute("aria-current", "page");

    await expect(browser.$(BACK)).toBeEnabled();
    // The tooltip names the destination rather than the gesture: a back button
    // that says only "Back" has to be pressed to find out what it does.
    await expect(browser.$(BACK)).toHaveAttribute("title", "Back to Songs");
    await expect(browser.$(FORWARD)).toBeDisabled();

    await capture("history-nav");

    await browser.$(BACK).click();

    await expect(view("Songs")).toHaveAttribute("aria-current", "page");
  });

  it("goes forward again to where back came from", async () => {
    await expect(browser.$(FORWARD)).toBeEnabled();
    await expect(browser.$(FORWARD)).toHaveAttribute("title", "Forward to Releases");

    await browser.$(FORWARD).click();

    await expect(view("Releases")).toHaveAttribute("aria-current", "page");
    await expect(browser.$(FORWARD)).toBeDisabled();
  });
});
