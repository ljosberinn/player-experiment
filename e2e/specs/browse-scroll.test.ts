import { browser, expect } from "@wdio/globals";

/**
 * Where a browse tab was left, in an engine that scrolls.
 *
 * `BrowseView.test.tsx` proves the arithmetic - the index written on unmount,
 * the offset read back, the reflow correction - against a stubbed
 * `clientWidth` and a `scrollTop` jsdom lets hold any number at all. None of
 * that is scrolling. A container jsdom never laid out cannot clamp an offset,
 * cannot fire the events the virtualizer listens to, and cannot tell a restore
 * that landed from one the engine quietly threw away.
 *
 * Runs after `virtualization`, which is what makes it possible: its synthetic
 * rows carry 800 albums and 250 artists, and a tab has to be taller than the
 * window before there is any position to remember.
 */

/** A library view in the sidebar, by its visible name. */
function view(name: string) {
  return browser.$(`//button[contains(@class,'sidebar-item')][normalize-space()='${name}']`);
}

/** `TILE_HEIGHT` and `LIST_ROW_HEIGHT` in `BrowseView.tsx`. */
const TILE_HEIGHT = 235;
const LIST_ROW_HEIGHT = 41;

const SCROLL = "[data-testid='browse-scroll']";

function scrollTop(): Promise<number> {
  return browser.execute(
    () => document.querySelector("[data-testid='browse-scroll']")?.scrollTop ?? -1,
  );
}

/**
 * Scrolls the open tab to `offset` and waits for the engine to report it.
 *
 * Set rather than dragged, and then read back: a browser clamps `scrollTop` to
 * the content it actually has, so an offset that was accepted is the only
 * evidence that the tab is as tall as this test assumes.
 */
async function scrollTo(offset: number): Promise<void> {
  await browser.execute((to: number) => {
    const body = document.querySelector("[data-testid='browse-scroll']");
    if (body !== null) {
      body.scrollTop = to;
    }
  }, offset);
  await browser.waitUntil(async () => (await scrollTop()) === offset, {
    timeout: 10_000,
    timeoutMsg: `the tab would not scroll to ${offset} - is it tall enough?`,
  });
}

/**
 * Opens a browse tab and waits for its rows.
 *
 * The rows rather than the container: the container is in the DOM while the
 * groups are still in flight, and the restore is what happens when they land.
 */
async function open(name: string): Promise<void> {
  await view(name).click();
  await expect(view(name)).toHaveAttribute("aria-current", "page");
  await browser.$(`${SCROLL} .browse-row`).waitForExist({ timeout: 30_000 });
}

/** Waits for the restore, which lands a frame or two after the rows. */
async function expectRestored(offset: number): Promise<void> {
  await browser.waitUntil(async () => (await scrollTop()) === offset, {
    timeout: 10_000,
    timeoutMsg: `the tab opened at ${await scrollTop()} rather than at ${offset}`,
  });
}

describe("where a browse tab was left", () => {
  after(async () => {
    // The spec after this one expects the songs table, not a browse tab.
    await view("Songs").click();
    await expect(view("Songs")).toHaveAttribute("aria-current", "page");
  });

  it("comes back to the row the grid was scrolled to", async () => {
    await open("Albums");
    // A whole number of rows, so the restore - which anchors on the group at
    // the top - has nothing to round away. Column-count independent for the
    // same reason: row 20 is row 20 however many tiles are on it.
    const grid = 20 * TILE_HEIGHT;
    await scrollTo(grid);

    await open("Artists");
    await expectRestored(0);

    await open("Albums");
    await expectRestored(grid);
  });

  it("gives a list its own place rather than the grid's", async () => {
    await open("Artists");
    const list = 40 * LIST_ROW_HEIGHT;
    await scrollTo(list);

    await open("Albums");
    await expectRestored(20 * TILE_HEIGHT);

    await open("Artists");
    await expectRestored(list);
  });

  it("comes back to the album that was opened rather than to the top", async () => {
    await open("Albums");
    await expectRestored(20 * TILE_HEIGHT);

    await browser.$(`${SCROLL} .browse-tile`).click();
    // The drill-in is the songs table, so the browse container is gone.
    await browser.$(".browse-back").waitForExist({ timeout: 30_000 });

    await browser.$(".browse-back").click();
    await browser.$(`${SCROLL} .browse-row`).waitForExist({ timeout: 30_000 });
    await expectRestored(20 * TILE_HEIGHT);
  });

  it("opens every tab at the top once a search has changed what they list", async () => {
    const search = browser.$("input[aria-label='Search Library']");
    await search.click();
    await browser.keys("a");
    await browser.waitUntil(async () => (await scrollTop()) === 0, {
      timeout: 30_000,
      timeoutMsg: "the grid did not go back to the top for a search",
    });

    await browser.keys(["Backspace"]);
    await open("Artists");
    // The offsets pointed into the unsearched list, which is not the list any
    // tab is showing now.
    await expectRestored(0);

    await open("Albums");
    await expectRestored(0);
  });
});
