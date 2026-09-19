import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { png } from "../fixtures";
import { emit } from "../invoke";
import { capture } from "../screenshot";

/** Where the files this spec drops are written; the app reads them by path. */
const dropDir = join(import.meta.dirname, "..", ".tmp", "drops");

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

/** What the square is pointing at, or "" when it is the empty placeholder. */
function artworkSource(): Promise<string> {
  return browser.execute(() => document.querySelector(".tag-cover-art")?.getAttribute("src") ?? "");
}

/**
 * Whether the square actually decoded what it was pointed at.
 *
 * `src` proves the URL was built; `naturalWidth` proves the protocol handler
 * answered with an image, which is the half that lives in Rust.
 */
function artworkDecoded(): Promise<boolean> {
  return browser.execute(() => {
    const art = document.querySelector(".tag-cover-art");
    return art instanceof HTMLImageElement && art.complete && art.naturalWidth > 0;
  });
}

/**
 * Where to aim a drop, in the physical pixels the OS event speaks.
 *
 * Read out of the page rather than assumed: the app divides by the same ratio
 * on the way in, so a hard-coded position would pass on the developer's display
 * and miss on a scaled one.
 */
function artworkCentre(): Promise<{ x: number; y: number } | null> {
  return browser.execute(() => {
    const block = document.querySelector(".tag-cover");
    if (block === null) {
      return null;
    }
    const box = block.getBoundingClientRect();
    const ratio = window.devicePixelRatio;
    return {
      x: Math.round((box.left + box.width / 2) * ratio),
      y: Math.round((box.top + box.height / 2) * ratio),
    };
  });
}

/**
 * A file dropped on the artwork block, and what the app does with it.
 *
 * The OS half is what cannot be driven from here: WebDriver has no drag, and
 * since phase 85a the page sees no HTML5 drop either - `wry` takes the drop and
 * Tauri emits it. So the events it emits are emitted, carrying a path to a file
 * this process wrote, and everything the app owns runs for real: the routing,
 * the hit test, the staging command and the preview.
 */
async function dropOnArtwork(bytes: Buffer, name: string): Promise<void> {
  const path = join(dropDir, name);
  mkdirSync(dropDir, { recursive: true });
  writeFileSync(path, bytes);

  const position = await artworkCentre();
  expect(position).not.toBeNull();
  await emit("tauri://drag-enter", { paths: [path], position });
  await emit("tauri://drag-drop", { paths: [path], position });
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

  it("outlines the block while a file is over it", async () => {
    // The only feedback a drop has now: `dragDropEnabled` makes the webview
    // answer "copy" to the cursor everywhere in the window, so the block saying
    // so itself is what tells the two apart.
    await openEditorOn("Drift");

    await emit("tauri://drag-enter", {
      paths: [join(dropDir, "hover.png")],
      position: await artworkCentre(),
    });

    await expect(browser.$(".tag-cover")).toHaveElementClass("drop-target");
    await capture("tag-editor-drop-hover");

    await emit("tauri://drag-leave", {});
    await expect(browser.$(".tag-cover")).not.toHaveElementClass("drop-target");
  });

  it("takes an image dropped on the square and shows it", async () => {
    // What no unit test can reach: the position arrives in physical pixels and
    // has to land on the block, the command stages the file it names, and the
    // square then loads it back over `cover://staged`.
    //
    // A real PNG rather than four magic bytes, because what is asserted is
    // that the webview *decoded* what came back.
    await openEditorOn("Drift");

    await dropOnArtwork(png([[20, 120, 200]]), "art.png");

    await expect(browser.$(".tag-cover-note")).toHaveText("New artwork selected.");
    await browser.waitUntil(async () => (await artworkSource()).includes("staged"), {
      timeout: 10_000,
      timeoutMsg: "the square never pointed at the staged image",
    });
    expect(await artworkDecoded()).toBe(true);
    expect(await artworkBox()).toEqual({ width: 120, height: 120 });

    await capture("tag-editor-dropped-artwork");
  });

  it("says why a dropped file that is not artwork was refused", async () => {
    await openEditorOn("Drift");

    await dropOnArtwork(Buffer.from("hi"), "notes.txt");

    // The sentence is the backend's, which is the only thing that has seen the
    // bytes: the extension is a label and says nothing about them.
    await expect(browser.$("[role='alert']")).toHaveText("Cover art has to be a JPEG or a PNG.");
    await expect(browser.$(".tag-cover-note")).toHaveText("No artwork.");

    await capture("tag-editor-drop-refused");
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
