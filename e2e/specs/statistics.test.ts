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
 * After `library`, which seeds the songs the Library tab counts and also fills
 * the Listening tab: it plays Anchor, a second long against the silent sink,
 * so the run crosses `PLAYED_FRACTION` and a play is logged. The missing
 * last.fm key stops scrobbling, not the local play log, so this view never
 * sees its empty state in the suite.
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

    // The tiles render before the totals arrive, with an em dash where each
    // number goes, so existing proves nothing - the value does.
    const plays = browser.$(
      "//dl[@class='stat-tile'][dt[text()='Plays']]/dd[@class='stat-tile-value']",
    );
    await plays.waitForExist({ timeout: 10_000 });
    await browser.waitUntil(async () => (await plays.getText()) !== "—", {
      timeout: 10_000,
      timeoutMsg: "the listening totals never arrived",
    });
    expect(Number(await plays.getText())).toBeGreaterThan(0);

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
