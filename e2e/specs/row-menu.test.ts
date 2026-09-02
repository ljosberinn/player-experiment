import { browser, expect } from "@wdio/globals";
import { LIBRARY } from "../fixtures";
import { openMenu } from "../menu";
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
 * Phase 43 added the keyboard route here too, for the same reason the pointer
 * one is here: the shortcut hands the trigger a *synthesized* `contextmenu`,
 * and whether Base UI opens on one of those is a question only a real webview
 * answers.
 *
 * Phase 49 added the Edit menu with a selection, which lives here rather than
 * in `menus.test.ts` for a mechanical reason: that spec runs before the
 * library is seeded, and the song entries only exist when rows are selected.
 *
 * Runs after `library.test.ts`, which is what puts songs in the shared
 * library: an empty table has no row to right-click.
 *
 * Phase 73's library removal is driven here as far as the confirmation and no
 * further. The library is shared with every spec after this one, and
 * confirming would take a song out from under them - so what is asserted is
 * the route to the question, not the answer.
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
 * Presses Shift+F10, by dispatching the event rather than pressing.
 *
 * `browser.keys(["Shift", "F10"])` was tried first and the page never saw a
 * keydown - F10 activates a window menu on Windows, and it is swallowed before
 * the webview. That is the same class of gap as the missing `contextmenu` and
 * `dblclick` above, and it has the same remedy.
 *
 * What survives the substitution is the part worth testing here: the shortcut
 * synthesizes the `contextmenu` event `ContextMenu.Trigger` owns, and whether
 * a *synthesized* one opens a Base UI menu is a question only a real webview
 * answers. `SongTable.test.tsx` proves the shortcut fires; jsdom cannot prove
 * the menu hears it. What is now uncovered anywhere is whether the OS delivers
 * the physical key, which is the same gap the media keys already have.
 */
async function pressShiftF10(): Promise<void> {
  await browser.execute(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }),
    );
  });
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
    // A menu left open would take the next test down with it - and one Escape
    // is not enough, because an open submenu takes the first one and leaves
    // its parent standing. That is what failed here on the first CI run.
    for (let escapes = 0; escapes < 3; escapes++) {
      if (!(await browser.$("//*[@role='menu']").isExisting())) {
        return;
      }
      await browser.keys("Escape");
    }
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

  it("opens on Shift+F10, with no pointer involved at all", async () => {
    // Selected by clicking, because the shortcut acts on the selection and
    // there is no keyboard route to one that does not go through this.
    await browser.$("tr.song-row").click();
    await browser.waitUntil(async () => await browser.$("tr.song-row.selected").isExisting());

    await pressShiftF10();

    await browser
      .$("//*[@role='menu'][@aria-label='Song actions']")
      .waitForExist({ timeout: 10_000, timeoutMsg: "Shift+F10 never opened the row menu" });
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

  it("serves the same entries from the Edit menu, under its own verb", async () => {
    // The menu bar acts on the selection, and clicking is the only route to
    // one - the same reason the Shift+F10 test above starts this way.
    await browser.$("tr.song-row").click();
    await browser.waitUntil(async () => await browser.$("tr.song-row.selected").isExisting());

    await openMenu("Edit");

    // The first two entries only, not the whole menu: `rowMenu.test.ts` owns
    // which entries appear, and asserting them again here would fail whenever
    // a spec before this one left a playlist open. What is worth pinning is
    // Edit ▸ Edit - what a menu bar does with the verb it is named for, and
    // the reason phase 49 did not invent a second name for the entry.
    const items = await itemsOf("Edit");
    expect(items.slice(0, 2)).toEqual(["Play", "Edit"]);
    expect(items).toContain("Undo Tag Edit");

    await capture("menubar-edit-with-a-selection");
  });

  it("offers the library removal on right-click but not in Edit", async () => {
    // The one entry the two menus deliberately disagree on: the user wants it
    // in File, beside the other row-destroying entry, so `AppMenus` leaves the
    // callback undefined and `rowMenuItems` drops it. Present once, not twice.
    await openRowMenu();
    expect(await itemsOf("Song actions")).toContain("Remove from Library…");
    await browser.keys("Escape");

    await browser.$("tr.song-row").click();
    await browser.waitUntil(async () => await browser.$("tr.song-row.selected").isExisting());
    await openMenu("Edit");

    expect(await itemsOf("Edit")).not.toContain("Remove from Library…");
  });

  it("asks before removing anything, and takes Cancel for an answer", async () => {
    // Followed as far as the question and no further: the library is shared
    // with every spec after this one, and confirming would take a song out
    // from under them. What is worth driving is the route - a right-click
    // reaching a dialog that names what it is about to do.
    await openRowMenu();
    await browser
      .$(
        "//*[@role='menu'][@aria-label='Song actions']//*[@role='menuitem'][normalize-space()='Remove from Library…']",
      )
      .click();

    const dialog = browser.$("[role='alertdialog']");
    await dialog.waitForExist({ timeout: 10_000, timeoutMsg: "the confirmation never opened" });
    await expect(dialog).toHaveText(/rescan will not bring it back/);

    await capture("remove-from-library");

    await browser.$("//button[normalize-space()='Cancel']").click();
    await dialog.waitForExist({ timeout: 10_000, reverse: true });
    // And the row it was asked about is still there.
    await expect(browser.$("tr.song-row")).toBeExisting();
  });

  it("opens the tag editor on Edit, titled the same as the entry", async () => {
    // The one entry it is safe to follow: the lookups open a browser on the
    // runner, and this opens a dialog. Cancel puts it back.
    await openRowMenu();
    await browser
      .$(
        "//*[@role='menu'][@aria-label='Song actions']//*[@role='menuitem'][normalize-space()='Edit']",
      )
      .click();

    const dialog = browser.$("[role='dialog']");
    await dialog.waitForExist({ timeout: 10_000, timeoutMsg: "the tag editor never opened" });
    await expect(browser.$("[role='dialog'] h2")).toHaveText("Edit");

    await capture("tag-editor");

    await browser.$("//button[normalize-space()='Cancel']").click();
    await dialog.waitForExist({ timeout: 10_000, reverse: true });
  });
});
