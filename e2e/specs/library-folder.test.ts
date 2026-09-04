import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { browser, expect } from "@wdio/globals";
import { invoke } from "../invoke";
import { chooseFromMenu } from "../menu";
import { capture } from "../screenshot";

/**
 * The Settings section that turns the Library folder on.
 *
 * A screenshot because the section is new furniture in a dialog that had none
 * of it: `LibraryFolderSettings.test.tsx` proves what the controls do and
 * `App.css.test.ts` reads the rules as text, but neither can say whether a
 * path, a button and a checkbox sit on the rows they are meant to.
 *
 * **The switch is never turned on here.** One app process serves the whole run
 * and the pass would then start filing the shared library out from under every
 * spec after this one. What that leaves untested is the moving, which
 * `library::worker`'s own tests cover over a temporary library of their own.
 *
 * The folder is set through `invoke` rather than through the button, for the
 * reason `invoke` exists: the button opens the OS folder picker, which no
 * driver here can answer.
 */

const ROOT = resolve(import.meta.dirname, "..", ".tmp", "library-folder");

async function openSettings(): Promise<void> {
  await chooseFromMenu("Edit", "Settings…");
  await browser.$(".settings-library").waitForExist({ timeout: 10_000 });
}

async function closeSettings(): Promise<void> {
  await browser.$("//button[text()='Done']").click();
  await browser.$("[role='dialog']").waitForExist({ timeout: 10_000, reverse: true });
}

describe("the library folder section", () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
      timeout: 30_000,
      interval: 500,
    });
  });

  after(async () => {
    // The folder this spec picked is a watch folder from here on, and the
    // specs after this one count what a scan finds. Taken back out while the
    // switch is off, which is the one time the backend allows it.
    await invoke("remove_watch_folder", { path: ROOT });
  });

  it("will not switch filing on until a folder is chosen", async () => {
    await openSettings();

    await expect(browser.$("#organize-library")).toBeDisabled();
    await expect(browser.$(".settings-library-root")).toHaveText(/None chosen/);

    await capture("settings-library-folder-unset");
    await closeSettings();
  });

  it("shows the chosen folder, and starts watching it", async () => {
    mkdirSync(ROOT, { recursive: true });
    await invoke("set_library_root", { path: ROOT });

    await openSettings();

    await expect(browser.$(".settings-library-root")).toHaveText(/library-folder/);
    await expect(browser.$("#organize-library")).toBeEnabled();
    await expect(browser.$("#organize-library")).not.toBeSelected();
    // A library filed into a folder nobody watches is marked missing in full
    // on the next scan, so picking one is also what starts watching it.
    const watched = browser.$(`//*[@class='settings-folders']//span[@title='${ROOT}']`);
    await expect(watched).toBeExisting();

    await capture("settings-library-folder");
    await closeSettings();
  });
});
