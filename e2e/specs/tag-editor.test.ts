import { browser, expect } from "@wdio/globals";
import { capture } from "../screenshot";

/**
 * The artwork block in the tag editor, in an engine that has layout.
 *
 * `TagEditor.test.tsx` proves the square is in the markup for every state and
 * `App.css.test.ts` proves a rule states its size, but neither can say the two
 * meet: jsdom applies no stylesheet and reports every element as zero-sized. An
 * image with no rule matching it draws at whatever size the file carries, which
 * is exactly the shape of the bug phase 50 fixes, and only a real webview can
 * report the size it ended up.
 *
 * Runs over the seeded library, and needs both halves of it: *Harbour* is the
 * one album the fixture gives artwork, so the songs with and without it are
 * both reachable by title.
 */

/** The square, as the browser measured it, or null when it is not drawn. */
function artworkBox(): Promise<{ width: number; height: number } | null> {
  return browser.execute(() => {
    const art = document.querySelector(".tag-cover-art");
    if (art === null) {
      return null;
    }
    const box = art.getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  });
}

/**
 * Opens the editor on the song called `title`.
 *
 * By title rather than by row index: which row is first depends on the sort the
 * specs before this one left behind, and this spec's whole subject is the
 * difference between a song with artwork and one without.
 *
 * The right-click is dispatched rather than pressed, for the reason
 * `row-menu.test.ts` documents at length: the Actions API produces no
 * `contextmenu` event against this driver at all.
 */
async function openEditorOn(title: string): Promise<void> {
  const found = await browser.execute((name: string) => {
    const row = Array.from(document.querySelectorAll("tr.song-row")).find((one) =>
      (one.textContent ?? "").includes(name),
    );
    if (row === undefined) {
      return false;
    }
    const box = row.getBoundingClientRect();
    row.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: Math.round(box.left + box.width / 2),
        clientY: Math.round(box.top + box.height / 2),
      }),
    );
    return true;
  }, title);
  expect(found).toBe(true);

  await browser
    .$("//*[@role='menu'][@aria-label='Song actions']")
    .waitForExist({ timeout: 10_000, timeoutMsg: `no row menu on ${title}` });
  await browser
    .$(
      "//*[@role='menu'][@aria-label='Song actions']//*[@role='menuitem'][normalize-space()='Edit']",
    )
    .click();
  await browser
    .$("[role='dialog']")
    .waitForExist({ timeout: 10_000, timeoutMsg: `the editor never opened on ${title}` });
}

/** Cancel, which is the only exit that writes nothing. */
async function closeEditor(): Promise<void> {
  const dialog = browser.$("[role='dialog']");
  if (!(await dialog.isExisting())) {
    return;
  }
  await browser.$("//button[normalize-space()='Cancel']").click();
  await dialog.waitForExist({ timeout: 10_000, reverse: true });
}

describe("the tag editor's artwork", () => {
  before(async () => {
    await browser.$("tr.song-row").waitForExist({ timeout: 30_000 });
  });

  afterEach(closeEditor);

  it("draws the artwork at the size the dialog states, not the size of the file", async () => {
    // The fixture's cover is a three-pixel-wide, one-pixel-tall PNG. Before
    // this phase nothing in the stylesheet matched the image, so it drew at
    // that - and a real library's 3000px cover drew at 3000px, which is what
    // turned the dialog into a scroll area.
    await openEditorOn("Anchor");

    expect(await artworkBox()).toEqual({ width: 120, height: 120 });

    await capture("tag-editor-artwork");
  });

  it("draws the same square for a song that has no artwork", async () => {
    // The state that used to be a sentence where the picture goes, so the
    // block changed shape with the selection. Phase 51 drops a file onto this
    // box, which needs it to exist before there is anything in it.
    await openEditorOn("Drift");

    expect(await artworkBox()).toEqual({ width: 120, height: 120 });
    await expect(browser.$(".tag-cover-art-empty")).toExist();
    await expect(browser.$(".tag-cover-note")).toHaveText("No artwork.");

    await capture("tag-editor-no-artwork");
  });

  it("keeps the square when a removal is pending", async () => {
    await openEditorOn("Anchor");

    await browser.$("//button[normalize-space()='Remove Artwork']").click();
    await expect(browser.$(".tag-cover-note")).toHaveText("Artwork will be removed.");

    // The caption changed; the box did not. That is the shape this phase is
    // for - the buttons under it do not move as the choice changes.
    expect(await artworkBox()).toEqual({ width: 120, height: 120 });
  });
});
