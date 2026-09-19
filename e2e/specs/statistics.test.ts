import { browser, expect } from "@wdio/globals";
import { invoke } from "../invoke";
import { capture } from "../screenshot";

/**
 * The Statistics view: the sidebar destination, its two tabs, and the panels
 * under each tile row.
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
      "Plays over time",
      "New artists",
      "When you listen",
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

  it("draws the week the plays fall in", async () => {
    const clock = panel("When you listen");
    // Cells, not a skeleton: the clock is 168 counts whatever was played, so
    // the grid existing says the aggregate landed, and the seed's quiet
    // nights are what make some of it the ramp's empty step.
    await browser.waitUntil(async () => (await clock.$$("rect.chart-cell").length) === 168, {
      timeout: 30_000,
      timeoutMsg: "the week clock never arrived",
    });
    await expect(clock.$("rect.chart-cell[data-step='0']")).toBeExisting();
    await expect(clock.$("rect.chart-cell[data-step='4']")).toBeExisting();
    // 24 hour bars under the grid, off the same answer.
    await expect(clock.$$("rect.chart-bar")).toBeElementsArrayOfSize(24);

    // Months: the seeded history is late 2023 and `library`'s one real play
    // is today, and the axis runs the whole span between them.
    const overTime = panel("Plays over time");
    await browser.waitUntil(async () => (await overTime.$$("rect.chart-bar").length) > 1, {
      timeout: 30_000,
      timeoutMsg: "plays over time never drew",
    });

    await clock.scrollIntoView({ block: "center" });
    await capture("statistics-listening-week");
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

    for (const title of [
      "Bitrates",
      "Sample rates",
      "Track lengths",
      "Release years",
      "Genres",
      "Albums by mean bitrate",
      "Tag health",
    ]) {
      await panel(title).waitForExist({ timeout: 30_000 });
    }

    // Bars, not a skeleton and not an empty state. `synthetic::seed` fills
    // the quality columns precisely so there is a distribution here to draw;
    // left at NULL they were one empty bin.
    await browser.waitUntil(async () => (await panel("Bitrates").$$("rect.chart-bar").length) > 1, {
      timeout: 30_000,
      timeoutMsg: "the bitrate histogram never arrived",
    });

    await capture("statistics-library");
  });

  it("reads the release years as decades without asking again", async () => {
    // The toggle is why there is one panel and not two: a decade is ten year
    // bins summed, and the second panel would have been a second full scan.
    const years = panel("Release years");
    await browser.waitUntil(async () => (await years.$$("rect.chart-bar").length) > 1, {
      timeout: 30_000,
      timeoutMsg: "the release years never arrived",
    });
    const before = await years.$$("rect.chart-bar").length;

    await years.$(".//button[normalize-space()='By decade']").click();

    // 55 synthetic years and a handful of real ones collapse to seven
    // decades, so fewer bars is the assertion that the rollup happened.
    await browser.waitUntil(async () => (await years.$$("rect.chart-bar").length) < before, {
      timeout: 10_000,
      timeoutMsg: "the decade rollup never drew",
    });
    await expect(years.$("button[aria-pressed='true']")).toBeExisting();

    await capture("statistics-library-decades");
  });

  /**
   * The drill only exists over the six fixture files. `Ambient`, `Downtempo`
   * and `Modern Classical` resolve through migration 11's tree and land under
   * a root that has something below it; the synthetic `Genre00`-`Genre19` are
   * in no layer of it, so they are roots with no children and no way down.
   */
  it("drills into a genre and narrows the whole tab with it", async () => {
    const genres = panel("Genres");
    await browser.waitUntil(async () => (await genres.$$("path.chart-slice").length) > 1, {
      timeout: 30_000,
      timeoutMsg: "the genre donut never arrived",
    });
    await genres.scrollIntoView({ block: "center" });
    await capture("statistics-library-genres");

    // The tag health's own count is what says the crumb reached the rest of
    // the tab rather than only the panel it was clicked in.
    const health = panel("Tag health");
    await browser.waitUntil(async () => (await health.$$("li").length) > 0, {
      timeout: 30_000,
      timeoutMsg: "the tag health never arrived",
    });
    const before = await health.getText();

    await genres.$("path.chart-slice[data-drills]").click();

    await expect(browser.$(".stats-breadcrumb")).toBeExisting();
    await browser.waitUntil(async () => (await health.getText()) !== before, {
      timeout: 30_000,
      timeoutMsg: "the genre crumb never reached the other panels",
    });

    await genres.scrollIntoView({ block: "center" });
    await capture("statistics-library-genre-drilled");
  });

  /**
   * The Statistics view's only writer. Opened and photographed rather than
   * driven: the fields are free text over 6,575 labels and both refusals are
   * asserted in Rust, where they live - what no unit test can answer is what
   * a two-field dialog looks like in this window.
   */
  it("opens the override editor on the genre it is drilled into", async () => {
    const genres = panel("Genres");
    await genres.$(".//button[normalize-space()='Fix a parent…']").click();

    const dialog = browser.$(".modal");
    await dialog.waitForExist({ timeout: 10_000 });
    await expect(dialog.$("h2")).toHaveText("Where this genre belongs");
    // Prefilled with the level the drill left the view on, not the first
    // slice: a parent reads wrong from inside the genre it is wrong about.
    await expect(dialog.$$("input")[0]).not.toHaveValue("");

    await capture("statistics-genre-override");

    await dialog.$(".//button[normalize-space()='Cancel']").click();
    await expect(dialog).not.toBeExisting();
  });

  it("goes back to Listening the way it goes back anywhere", async () => {
    // Two steps now: the genre crumb first, then the tab.
    await browser.$("button[aria-label='Back']").click();
    await browser.$("button[aria-label='Back']").click();

    await expect(browser.$("[role='tab'][aria-selected='true']")).toHaveText("Listening");
  });
});
