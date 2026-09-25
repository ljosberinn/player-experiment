import { browser, expect } from "@wdio/globals";
import { menuItem } from "../menu";
import { capture } from "../screenshot";

/**
 * Loving a song puts it in Favorites, on a build with no last.fm key.
 *
 * Every CI build is compiled without one, which is the case Favorites has to
 * work in: the loved set is the library's own. Between the row menu and the
 * built-in sit a command, the `loved` table, the smart filter and the sidebar,
 * and "the song is there" is a fact about all of them at once.
 *
 * Its own file rather than a case in `row-menu.test.ts`, which flakes on the
 * Windows runner. Runs after `library.test.ts`, which puts the songs in the
 * shared library, and unloves what it loved so the specs after it find the
 * library as it was.
 */

/** The titles on screen, in the order the table puts them. */
function titles(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll("tr.song-row")).map((one) =>
      (one.querySelector("td.song-cell[data-column='title']")?.textContent ?? "").trim(),
    ),
  );
}

/** A LIBRARY row, by its visible label; see `smart-playlists.test.ts`. */
function libraryView(label: string) {
  return browser.$(
    `//button[contains(@class,'sidebar-item')][.//span[normalize-space(.)='${label}']]`,
  );
}

/** Right-clicks the first row; see `row-menu.test.ts` for why it is dispatched. */
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

async function choose(item: string): Promise<void> {
  await openRowMenu();
  await browser.$(menuItem("Song actions", item)).click();
  await browser.$("//*[@role='menu']").waitForExist({ timeout: 10_000, reverse: true });
}

describe("Favorites", () => {
  let loved = "";

  before(async () => {
    await browser.$("tr.song-row").waitForExist({ timeout: 30_000 });
  });

  it("is empty until a song is loved, and says how to fill it", async () => {
    await libraryView("Favorites").click();

    await expect(browser.$(".empty-state")).toHaveText(/Love a song to add it here/);
  });

  it("holds a song loved from the row menu", async () => {
    await libraryView("Songs").click();
    await browser.$("tr.song-row").waitForExist({ timeout: 30_000 });
    loved = (await titles())[0] ?? "";
    expect(loved).not.toBe("");

    await choose("Love");
    await libraryView("Favorites").click();

    await browser.waitUntil(async () => (await titles()).includes(loved), {
      timeout: 10_000,
      timeoutMsg: `${loved} never appeared in Favorites`,
    });
    await capture("favorites");
  });

  after(async () => {
    await browser.keys(["Escape"]);
    // Unloved from inside Favorites, where the only row is the one loved.
    if ((await titles()).includes(loved)) {
      await choose("Unlove");
    }
    await libraryView("Songs").click();
  });
});
