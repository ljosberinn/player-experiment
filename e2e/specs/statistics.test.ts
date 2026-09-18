import { browser, expect } from "@wdio/globals";
import { capture } from "../screenshot";

/**
 * The Statistics view: the sidebar destination, its two tabs and the tile row
 * under each.
 *
 * Screenshots because this is a view the design has no mockup for, so what a
 * tab strip, a filter bar and a row of tiles look like together is exactly the
 * thing no unit test can answer.
 *
 * After `library`, which seeds the songs the Library tab counts. The Listening
 * tab is empty by design here: the e2e build carries no last.fm key, nothing
 * has been played, and its empty state is worth a photograph of its own.
 */

/** A library view in the sidebar, by its visible name. */
function view(name: string) {
  return browser.$(`//button[contains(@class,'sidebar-item')][normalize-space()='${name}']`);
}

describe("the Statistics view", () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
      timeout: 30_000,
      interval: 250,
    });
  });

  after(async () => {
    // The specs after this one expect the songs table.
    await view("Songs").click();
    await expect(view("Songs")).toHaveAttribute("aria-current", "page");
  });

  it("opens from the sidebar, on Listening", async () => {
    await view("Statistics").click();

    await expect(view("Statistics")).toHaveAttribute("aria-current", "page");
    await expect(browser.$("[role='tab'][aria-selected='true']")).toHaveText("Listening");
    // Nothing has been played in this build, and a row of zeros would say the
    // same thing less usefully.
    await expect(browser.$(".empty-state")).toBeExisting();

    await capture("statistics-listening");
  });

  it("counts the library on the other tab", async () => {
    await browser.$("//button[@role='tab'][normalize-space()='Library']").click();

    const tiles = browser.$(".stat-tiles");
    await tiles.waitForExist({ timeout: 10_000 });
    // The seeded library, through `stats_library_totals` rather than through
    // the count under the table.
    await expect(browser.$("//dl[@class='stat-tile'][dt[text()='Songs']]")).toBeExisting();

    await capture("statistics-library");
  });

  it("goes back to Listening the way it goes back anywhere", async () => {
    await browser.$("button[aria-label='Back']").click();

    await expect(browser.$("[role='tab'][aria-selected='true']")).toHaveText("Listening");
  });
});
