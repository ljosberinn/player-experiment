import { browser, expect } from "@wdio/globals";
import { invoke } from "../invoke";
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
  await browser.$(".appbar").waitForExist({ timeout: 30_000 });
}

/** The stored view's fields a spec here tells views apart by. */
type StoredView = { tab: string; playlistId: number | null };

const atSongs = (stored: StoredView) => stored.tab === "songs" && stored.playlistId === null;

/**
 * Reloads once the stored view passes `stored`, so the next launch opens there.
 *
 * Waited for rather than assumed, for the sidebar spec's reason: the write
 * trails the click, and a reload that beats it opens the view before.
 */
async function reloadOnceStored(stored: (view: StoredView) => boolean): Promise<void> {
  await browser.waitUntil(
    async () => {
      const json = await invoke<string | null>("load_view");
      // Never written means the launch default, which is Songs.
      const view: StoredView =
        json === null ? { tab: "songs", playlistId: null } : JSON.parse(json);
      return stored(view);
    },
    { timeout: 10_000, timeoutMsg: "the open view never reached the settings table" },
  );
  await browser.refresh();
  await waitForTheApp();
}

describe("back and forward", () => {
  before(async () => {
    // A reload rather than a guessed starting point: the specs share one app
    // process, so whatever ran before this has already navigated somewhere.
    // From Songs, because a reload now reopens wherever that was.
    await waitForTheApp();
    await view("Songs").click();
    await reloadOnceStored(atSongs);
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

describe("the open view", () => {
  after(async () => {
    await view("Songs").click();
    await reloadOnceStored(atSongs);
  });

  it("is open again after the app comes back", async () => {
    // A built-in, because the library is empty here and they are always there.
    await view("Recently Added").click();
    await expect(view("Recently Added")).toHaveAttribute("aria-current", "page");

    await reloadOnceStored((stored) => stored.playlistId !== null);
    await expect(view("Recently Added")).toHaveAttribute("aria-current", "page");
    // The last session's history is not restored.
    await expect(browser.$(BACK)).toBeDisabled();
  });
});
