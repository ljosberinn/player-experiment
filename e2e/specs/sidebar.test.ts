import { browser, expect } from "@wdio/globals";

/**
 * Folding a sidebar section, and finding it still folded next launch.
 *
 * The persistence is the whole point of the feature and the half a component
 * test cannot reach: `PlaylistSidebar.test.tsx` proves the section hides when
 * the heading is pressed, against a mocked `loadSidebarSections` that answers
 * whatever the test tells it to. Whether the value ever arrives in SQLite, and
 * whether what comes back out is what went in, is a round trip through a
 * command, a settings row and a JSON payload - four places for it to be lost.
 *
 * A reload is how a spec reaches the next launch without restarting the
 * process, the same trick the crash notice uses.
 *
 * Runs before the library is seeded because none of this needs songs, and it
 * leaves every section open again so the specs after it find the sidebar as
 * they expect.
 */

/** The heading button that folds a section, by the section's visible name. */
function fold(name: string) {
  return browser.$(`//button[@aria-expanded][contains(., '${name}')]`);
}

async function waitForTheApp(): Promise<void> {
  await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
    timeout: 30_000,
    interval: 250,
  });
  await browser.$(".statusbar-summary").waitForExist({ timeout: 30_000 });
}

describe("the sidebar sections", () => {
  before(async () => {
    await waitForTheApp();
  });

  after(async () => {
    // Whatever this spec did, the next one starts with an open sidebar.
    for (const name of ["Smart Playlists", "Playlists"]) {
      const heading = fold(name);
      if ((await heading.getAttribute("aria-expanded")) === "false") {
        await heading.click();
      }
    }
  });

  it("folds a section away and opens it again", async () => {
    const playlists = fold("Playlists");
    await expect(playlists).toHaveAttribute("aria-expanded", "true");

    await playlists.click();
    await expect(playlists).toHaveAttribute("aria-expanded", "false");
    // The contents are gone from the document, not merely hidden: a hidden
    // drop target is a thing a drag can still find and a keyboard cannot.
    await expect(browser.$("[data-testid='playlist-dropzone']")).not.toBeExisting();

    await playlists.click();
    await expect(playlists).toHaveAttribute("aria-expanded", "true");
    await expect(browser.$("[data-testid='playlist-dropzone']")).toBeExisting();
  });

  it("is still folded after the app comes back", async () => {
    await fold("Smart Playlists").click();
    await expect(fold("Smart Playlists")).toHaveAttribute("aria-expanded", "false");

    await browser.refresh();
    await waitForTheApp();

    // The assertion the feature exists for. A sidebar arranged once stays
    // arranged, which means the JSON reached SQLite and parsed back out.
    await expect(fold("Smart Playlists")).toHaveAttribute("aria-expanded", "false");
    // And the section that was not folded is still open, so what came back is
    // the arrangement rather than a blanket default.
    await expect(fold("Playlists")).toHaveAttribute("aria-expanded", "true");
  });

  it("does not offer to fold the library away", async () => {
    // Four items that are the app's primary navigation. A user who collapsed
    // them would have hidden the way back to their songs.
    const library = browser.$("//h2[contains(., 'Library')]");
    await expect(library).toBeExisting();
    await expect(library.$("button")).not.toBeExisting();
  });
});
