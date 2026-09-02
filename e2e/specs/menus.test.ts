import { browser, expect } from "@wdio/globals";
import { closeMenu, itemsOf, openMenu } from "../menu";
import { capture } from "../screenshot";

/**
 * The menu bar, in the engine that opens it.
 *
 * `menus.ts` is pure and tested as such - which entries appear, which are
 * disabled, what they say. None of that says a popup ever opens. Base UI's
 * `Menubar` is real behaviour attached to real focus management, and the two
 * ways it can fail here are the two jsdom cannot see: a trigger that opens
 * nothing, and a popup that renders somewhere off screen.
 *
 * Deliberately not clicked: Help's one entry. Following it would open a browser
 * on the runner, which is a side effect a test suite has no business having.
 * That it exists, is enabled, and names the repository is what matters.
 */

/**
 * Whether an element is marked unavailable, by any of the three mechanisms.
 *
 * Base UI may express it as the `disabled` property, `aria-disabled`, or a
 * `data-disabled` attribute depending on what the part renders as, and which
 * one is not this suite's business - a user cannot press it either way. Naming
 * a single attribute here would make this a test of Base UI's internals that
 * passes or fails on an upgrade rather than on a regression.
 */
async function isUnavailable(selector: string): Promise<boolean> {
  return browser.execute((sel: string) => {
    const element = document.querySelector(sel);
    if (element === null) {
      return false;
    }
    return (
      (element as HTMLButtonElement).disabled === true ||
      element.getAttribute("aria-disabled") === "true" ||
      element.hasAttribute("data-disabled")
    );
  }, selector);
}

describe("the menu bar", () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
      timeout: 30_000,
      interval: 500,
    });
    await browser.$(".menubar").waitForExist({ timeout: 30_000 });
  });

  afterEach(async () => {
    // A test that failed with a menu open would take the next one down with it.
    try {
      await closeMenu();
    } catch {
      // Nothing was open, or the session has gone; either way the test that
      // mattered has already reported.
    }
  });

  it("opens File on the actions that used to be a toolbar", async () => {
    await openMenu("File");

    // Nothing selected, nothing missing and nothing removed, so none of the
    // three destructive entries is here - which is the conditional this menu
    // exists to get right. The library is also empty at this point in the run,
    // so there is nothing that could be selected.
    expect(await itemsOf("File")).toEqual(["Add Folders…", "Rescan"]);
  });

  it("opens Edit on what a right-click offers, plus what it does not", async () => {
    await openMenu("Edit");
    const items = await itemsOf("Edit");

    // Nothing is selected here, so the song actions are absent and what is
    // left acts on the app rather than on songs.
    expect(items).toEqual(["Undo Tag Edit", "Settings…"]);
  });

  it("reaches Settings from the Edit menu", async () => {
    await openMenu("Edit");
    await browser.$("//*[@role='menuitem'][normalize-space()='Settings…']").click();

    const dialog = browser.$("[role='dialog']");
    await dialog.waitForExist({ timeout: 10_000 });
    await expect(dialog).toHaveText(/Interface Zoom/);

    await capture("settings");

    await browser.$("//button[normalize-space()='Done']").click();
    await dialog.waitForExist({ timeout: 10_000, reverse: true });
  });

  it("offers both exports, and disables the one with nothing to export", async () => {
    await openMenu("Export");

    expect(await itemsOf("Export")).toEqual(["Export All…", "Export Selection…"]);

    // Nothing selected and no playlist open: the entry stays, greyed. It is
    // the same action waiting for a subject.
    expect(
      await isUnavailable("[role='menu'][aria-label='Export'] [role='menuitem']:nth-of-type(2)"),
    ).toBe(true);
  });

  it("shows Account, and refuses to open it", async () => {
    // Present now so the bar does not change shape when last.fm arrives.
    const account = browser.$(
      "//*[@role='menubar']//*[@role='menuitem'][normalize-space()='Account']",
    );
    await expect(account).toBeExisting();

    const marked = await browser.execute(() =>
      Array.from(document.querySelectorAll("[role='menubar'] [role='menuitem']")).some(
        (item) =>
          (item.textContent ?? "").trim() === "Account" &&
          ((item as HTMLButtonElement).disabled === true ||
            item.getAttribute("aria-disabled") === "true" ||
            item.hasAttribute("data-disabled")),
      ),
    );
    expect(marked).toBe(true);

    await account.click();
    // Still nothing open. `isExisting` rather than a wait: the assertion is
    // that no popup appeared, and waiting for one to not appear is the slowest
    // possible way to say so.
    expect(await browser.$("//*[@role='menu'][@aria-label='Account']").isExisting()).toBe(false);
  });

  it("points Help at the repository without following it", async () => {
    await openMenu("Help");

    expect(await itemsOf("Help")).toEqual(["Source Code on GitHub"]);
  });

  it("looks like this", async () => {
    // The photograph. No assertion on its contents - it is for the reviewer of
    // whichever pull request changes what the bar looks like.
    await openMenu("File");
    await capture("menubar-file");
  });

  it("rescans on F5", async () => {
    // The library is empty at this point in the run, so a scan is fast and
    // finds nothing. What is being tested is that the key reaches the store at
    // all: F5 is bound window-wide and swallowed inside a text field, and both
    // halves of that are invisible to a unit test.
    await browser.$("body").click();
    await browser.keys(["F5"]);

    // The app is still standing and still answering afterwards. A scan that
    // threw would leave the error popover up, which is the failure worth
    // catching here.
    await expect(browser.$(".statusbar-summary")).toBeExisting();
    expect(await browser.$("[role='alert']").isExisting()).toBe(false);
  });
});
