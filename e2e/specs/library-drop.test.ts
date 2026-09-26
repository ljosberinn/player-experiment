import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { emit } from "../invoke";
import { capture } from "../screenshot";

/**
 * A file dropped on the library pane.
 *
 * The OS half is what cannot be driven from here - WebDriver has no drag, and
 * `wry` takes the drop before the page could see one - so the events it emits
 * are emitted, and everything from the routing inwards runs for real: the hit
 * test against the pane's rect, the ingest command, and the sentence a refusal
 * comes back with.
 *
 * **Nothing here is allowed to land in the library.** One app process serves
 * the whole run and the specs after this one count what a scan found, so the
 * only drop performed is the one that is refused: the Library folder is off,
 * the file is outside every watch folder, and the command's contract is that it
 * then moves nothing. The folder and in-place cases are covered by
 * `library::ingest`'s own tests, over a library of their own.
 */

const dropDir = join(import.meta.dirname, "..", ".tmp", "library-drops");

/** The centre of the library pane, in the physical pixels the event carries. */
function paneCentre(): Promise<{ x: number; y: number } | null> {
  return browser.execute(() => {
    const pane = document.querySelector(".content");
    if (pane === null) {
      return null;
    }
    const box = pane.getBoundingClientRect();
    const ratio = window.devicePixelRatio;
    return {
      x: Math.round((box.left + box.width / 2) * ratio),
      y: Math.round((box.top + box.height / 2) * ratio),
    };
  });
}

describe("dropping files on the library", () => {
  before(async () => {
    await browser.$("tr.song-row").waitForExist({ timeout: 30_000 });
    mkdirSync(dropDir, { recursive: true });
  });

  it("outlines the pane while a file is over it", async () => {
    // The only feedback a drop has: `dragDropEnabled` makes the webview answer
    // "copy" to the cursor everywhere in the window, so the pane saying so
    // itself is what tells the two apart.
    await emit("tauri://drag-enter", {
      paths: [join(dropDir, "hover.mp3")],
      position: await paneCentre(),
    });

    await expect(browser.$(".content")).toHaveElementClass("drop-target");
    await capture("library-drop-hover");

    await emit("tauri://drag-leave", {});
    await expect(browser.$(".content")).not.toHaveElementClass("drop-target");
  });

  it("says why a loose file with nowhere to go was refused", async () => {
    const path = join(dropDir, "orphan.mp3");
    writeFileSync(path, "not really an mp3, and never read");
    const position = await paneCentre();

    await emit("tauri://drag-enter", { paths: [path], position });
    await emit("tauri://drag-drop", { paths: [path], position });

    // The file is outside every watch folder and the Library folder is off, so
    // there is nowhere to put it and adding its parent would pull the whole of
    // that folder in.
    await expect(browser.$("[role='alertdialog']")).toBeDisplayed();
    await capture("library-drop-refused");

    // Left up, the dialog would stand over every spec after this one.
    await browser.keys(["Escape"]);
    await browser.$("[role='alertdialog']").waitForExist({ timeout: 10_000, reverse: true });
  });
});
