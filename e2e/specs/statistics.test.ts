import { browser, expect } from "@wdio/globals";
import { invoke } from "../invoke";
import { capture } from "../screenshot";

/**
 * The Statistics view: the sidebar destination, its two tabs, and the
 * Listening tab's panels under the tile row.
 *
 * Screenshots because this is a view the design has no mockup for, so what a
 * tab strip, a filter bar, a row of tiles and a column of panels look like
 * together is exactly the thing no unit test can answer.
 *
 * The suite's only real play is the second of Anchor `library` logs, which is
 * one bar in every panel here - so this seeds a history first. Inserted rather
 * than imported, and only an e2e build will do it: five thousand scrobbles
 * through a mocked last.fm would be testing the importer, which has its own
 * tests, and the command refuses in any build a user could install.
 *
 * Seeded before the view is opened, because `refresh` is a no-op while
 * Statistics is showing - the panels read when they mount.
 */

/** Enough plays to fill a top ten and a month of days. */
const PLAYS = 5_000;

/** A library view in the sidebar, by its visible name. */
function view(name: string) {
  return browser.$(`//button[contains(@class,'sidebar-item')][normalize-space()='${name}']`);
}

/** A tile's value, by the label above it. */
function tile(label: string) {
  return browser.$(`//dl[@class='stat-tile'][dt[text()='${label}']]/dd[@class='stat-tile-value']`);
}

/**
 * The panel under a heading.
 *
 * `.//h3` rather than `h3`: the heading sits inside the panel's `<header>`
 * beside whatever control is that panel's own, so a child-axis predicate
 * matches nothing.
 */
function panel(title: string) {
  return browser.$(`//section[@class='stats-panel'][.//h3[normalize-space()='${title}']]`);
}

describe("the Statistics view", () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
      timeout: 30_000,
      interval: 250,
    });

    const seeded = await invoke<number>("seed_synthetic_plays", { count: PLAYS });
    expect(seeded).toBe(PLAYS);
  });

  after(async () => {
    // The spec after this one expects the songs table.
    await view("Songs").click();
    await expect(view("Songs")).toHaveAttribute("aria-current", "page");
  });

  it("opens from the sidebar, on Listening", async () => {
    await view("Statistics").click();

    await expect(view("Statistics")).toHaveAttribute("aria-current", "page");
    await expect(browser.$("[role='tab'][aria-selected='true']")).toHaveText("Listening");

    // The tiles render before the totals arrive, with an em dash where each
    // number goes, so existing proves nothing - the value does.
    const plays = tile("Plays");
    await plays.waitForExist({ timeout: 10_000 });
    await browser.waitUntil(async () => (await plays.getText()) !== "—", {
      timeout: 30_000,
      timeoutMsg: "the listening totals never arrived",
    });
    expect(Number((await plays.getText()).replaceAll(/\D/g, ""))).toBeGreaterThan(PLAYS);
  });

  it("draws a panel per question under the tiles", async () => {
    for (const title of [
      "Streaks",
      "Top artists",
      "Top albums",
      "Top tracks",
      "Top genres",
      "Heard, never owned",
      "Recent plays",
    ]) {
      await panel(title).waitForExist({ timeout: 30_000 });
    }

    // Two thirds of the seeded plays match a synthetic track and a third never
    // do, so both the owned share and the shopping list have something in them
    // - which is the state worth photographing. Re-queried each tick rather
    // than held: the list is empty until the aggregate lands.
    await browser.waitUntil(async () => (await panel("Heard, never owned").$$("li").length) > 0, {
      timeout: 30_000,
      timeoutMsg: "the residue never arrived",
    });

    await capture("statistics-listening");
  });

  it("drills into an artist by clicking its bar", async () => {
    // The row, not the panel's own control: a top list has no header button,
    // but the residue below it does, and naming the class says which is meant.
    const bar = panel("Top artists").$("button.bar-list-row");
    await bar.waitForExist({ timeout: 30_000 });
    const artist = await bar.$(".bar-list-label").getText();

    await bar.click();

    // The crumb is the way back, and the panel that would list this artist
    // among others is gone: drilling narrows the tab rather than opening a
    // page of its own.
    await expect(browser.$(".stats-breadcrumb")).toHaveText(new RegExp(artist));
    await expect(panel("Top artists")).not.toBeExisting();
    await expect(panel("Top albums")).toBeExisting();

    await capture("statistics-listening-artist");
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
