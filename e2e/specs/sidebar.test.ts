import { browser, expect } from "@wdio/globals";
import { invoke } from "../invoke";

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

/**
 * The heading button that folds a section, by the section's visible name.
 *
 * `normalize-space(.)` rather than `contains(.)`, which is what the first
 * version used and which is wrong here in a way that looked right: "Smart
 * Playlists" contains "Playlists", and `$` returns the first match in document
 * order - so asking for Playlists folded the smart section instead, reported
 * itself collapsed quite correctly, and then failed on the other section's
 * drop zone still being there.
 */
function fold(name: string) {
  return browser.$(`//button[@aria-expanded][normalize-space(.)='${name}']`);
}

/**
 * Puts a section into the state a test needs, whatever state it is in.
 *
 * Rather than assuming: these specs share one app process and one library, so
 * a test that failed halfway through leaves the sidebar however it got to, and
 * the next one asserting from a guessed starting point fails as a puzzle
 * rather than as itself.
 */
async function setFolded(name: string, folded: boolean): Promise<void> {
  const heading = fold(name);
  // Spelled out rather than compared against `String(!folded)`, which is how
  // the first version of this managed to click whenever the section was
  // already in the state being asked for - inverted, and inverted in a way
  // that reads fine.
  const isOpen = (await heading.getAttribute("aria-expanded")) === "true";
  const wantOpen = !folded;
  if (isOpen !== wantOpen) {
    await heading.click();
  }
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
      await setFolded(name, false);
    }
  });

  it("folds a section away and opens it again", async () => {
    await setFolded("Playlists", false);
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
    // One folded and one open, so what comes back can be told apart from a
    // blanket default in either direction.
    await setFolded("Playlists", false);
    await setFolded("Smart Playlists", true);
    await expect(fold("Smart Playlists")).toHaveAttribute("aria-expanded", "false");

    // Waited for rather than assumed. Folding paints before it stores - it is
    // a pointer gesture and must not wait for SQLite to look like it happened
    // - so a reload fired straight after the click could beat the write and
    // fail as "persistence is broken" when it is only a race in the test.
    // Reading the setting back is also the most direct evidence there is that
    // the value reached the database at all.
    await browser.waitUntil(
      async () => {
        const stored = await invoke<string | null>("load_sidebar_sections");
        return stored !== null && stored.includes("smart");
      },
      { timeout: 10_000, timeoutMsg: "the folded section never reached the settings table" },
    );

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
