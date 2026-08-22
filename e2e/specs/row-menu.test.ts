import { browser, expect } from "@wdio/globals";
import { LIBRARY } from "../fixtures";
import { capture } from "../screenshot";

/**
 * The row's own right-click menu, and the submenus that open out of it.
 *
 * `rowMenu.test.ts` proves which entries appear and what URL each one builds,
 * and `SongTable.test.tsx` proves the row under the pointer is the one they
 * name. Neither says a right-click reaches any of it: the same entries are
 * also served by the Edit menu, so driving them from the menu bar would test
 * `rowMenuItems` twice and the pointer route never.
 *
 * Deliberately not clicked: the entries themselves. Following one opens a
 * browser on the runner, which is a side effect a test suite has no business
 * having - the same line `menus.test.ts` draws around Help.
 *
 * Runs after `library.test.ts`, which is what puts songs in the shared
 * library: an empty table has no row to right-click.
 */

/** The song whose row the menu is opened on, and what it is tagged with. */
const SONG = LIBRARY[0] as (typeof LIBRARY)[number];

/**
 * Right-clicks the first row, by dispatching the event rather than pressing.
 *
 * `click({ button: "right" })` goes through the Actions API, which against
 * this driver produces no `contextmenu` event at all - the limitation
 * `smart-playlists.test.ts` documents, and the remedy is the same one: give
 * React the event it listens for, at the row's own coordinates, because
 * `ContextMenu.Trigger` derives the menu's position from it.
 */
async function openRowMenu(): Promise<void> {
  await browser.execute(() => {
    const trigger = document.querySelector("tr.song-row");
    if (trigger === null) {
      return;
    }
    const box = trigger.getBoundingClientRect();
    trigger.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: Math.round(box.left + box.width / 2),
        clientY: Math.round(box.top + box.height / 2),
      }),
    );
  });
  await browser
    .$("//*[@role='menu'][@aria-label='Song actions']")
    .waitForExist({ timeout: 10_000, timeoutMsg: "the row menu never opened" });
}

/**
 * The labels inside an open menu.
 *
 * Trimmed of the submenu arrow, which is a `<span>` inside the trigger and so
 * lands in its `textContent`.
 */
function itemsOf(label: string): Promise<string[]> {
  return browser.execute((name: string) => {
    const popup = document.querySelector(`[role='menu'][aria-label='${name}']`);
    if (popup === null) {
      return [];
    }
    return Array.from(popup.querySelectorAll("[role='menuitem']")).map((item) =>
      (item.textContent ?? "").replace("▸", "").trim(),
    );
  }, label);
}

describe("the row menu", () => {
  before(async () => {
    await browser.$("tr.song-row").waitForExist({ timeout: 30_000 });
  });

  afterEach(async () => {
    // A menu left open would take the next test down with it.
    await browser.keys("Escape");
    await browser.$("//*[@role='menu']").waitForExist({ timeout: 10_000, reverse: true });
  });

  it("opens on a right-click, offering both lookups", async () => {
    await openRowMenu();

    const items = await itemsOf("Song actions");
    expect(items).toContain("Open Artist on…");
    expect(items).toContain("Open Album on…");
  });

  it("opens the artist submenu on the two sites, without following either", async () => {
    await openRowMenu();

    // Clicking a submenu trigger opens it rather than choosing anything, which
    // is the whole reason it is safe to drive here.
    await browser
      .$(
        "//*[@role='menu'][@aria-label='Song actions']//*[@role='menuitem'][contains(., 'Open Artist on')]",
      )
      .click();
    const submenu = browser.$("//*[@role='menu'][@aria-label='Open Artist on…']");
    await submenu.waitForExist({ timeout: 10_000, timeoutMsg: "the artist submenu never opened" });

    expect(await itemsOf("Open Artist on…")).toEqual(["Last.fm", "Discogs"]);

    await capture("row-menu-open-artist-on");
  });

  it("offers the album lookup only where the row has one", async () => {
    // Every fixture track is tagged with an album, so the entry is present -
    // and the fixture is what would have to change for that to stop being
    // true, which is why it is asserted rather than assumed.
    expect(SONG.album).toBeTruthy();

    await openRowMenu();

    await browser
      .$(
        "//*[@role='menu'][@aria-label='Song actions']//*[@role='menuitem'][contains(., 'Open Album on')]",
      )
      .click();
    await browser
      .$("//*[@role='menu'][@aria-label='Open Album on…']")
      .waitForExist({ timeout: 10_000, timeoutMsg: "the album submenu never opened" });

    expect(await itemsOf("Open Album on…")).toEqual(["Last.fm", "Discogs"]);
  });
});
