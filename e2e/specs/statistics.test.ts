import { browser, expect } from "@wdio/globals";
import { invoke } from "../invoke";
import { capture } from "../screenshot";

/**
 * The Statistics view: the sidebar destination, its Listening and Library tabs,
 * and the panels under each tile row.
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

/** A headline figure's value, by the label above it. The Listening tab draws
 * its four bare counts on the rule and only the qualified three in cells. */
function figure(label: string) {
  return browser.$(`//dl[@class='stat-row']/div[dt[text()='${label}']]/dd`);
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

    // The figures render before the totals arrive, with an em dash where each
    // number goes, so existing proves nothing - the value does.
    const plays = figure("Plays");
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

  it("measures the current streak against the record", async () => {
    const streaks = panel("Streaks");
    // Seven whatever the answer is: the strip is a fixed week rather than a
    // series, so it is drawn before the aggregate lands and does not grow.
    await expect(streaks.$$(".streak-day")).toBeElementsArrayOfSize(7);

    // The record is an em dash until the walk returns, so existing proves
    // nothing here for the reason it proves nothing about the tiles.
    const record = streaks.$(".streak-caption span:last-child");
    await browser.waitUntil(async () => (await record.getText()) !== "Record —", {
      timeout: 30_000,
      timeoutMsg: "the streaks never arrived",
    });

    // `seed_plays` lays 1,000 a week from Monday 2023-11-13, so 5,000 is five
    // unbroken weeks and the record is a run rather than a single day.
    expect(Number((await record.getText()).replaceAll(/\D/g, ""))).toBeGreaterThan(1);
  });

  it("draws the week the plays fall in", async () => {
    const clock = panel("When you listen");
    // Stepped cells, not a grid: since 116b the skeleton is the same grid
    // drawn empty - it is what holds the panel's height - so 168 cells says
    // nothing about whether the answer landed and 168 *coloured* ones does.
    // The clock is 168 counts whatever was played, and the seed's quiet nights
    // are what make some of them the ramp's empty step.
    await browser.waitUntil(
      async () => (await clock.$$(".heatmap-cell[data-step]").length) === 168,
      { timeout: 30_000, timeoutMsg: "the week clock never arrived" },
    );
    await expect(clock.$(".heatmap-cell[data-step='0']")).toBeExisting();
    await expect(clock.$(".heatmap-cell[data-step='7']")).toBeExisting();
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

  /**
   * The Listening tab's writer, opened the way the genre one is: from the
   * panel's own action, on the album the view is drilled into. Photographed
   * rather than driven - the three corrections are one write, asserted in
   * Rust and in the component's own tests, and what neither can answer is
   * what a list of spellings looks like in this window.
   *
   * `seed_plays` renames one play in four of each album to
   * `… (Deluxe Edition)` and the seed command folds them back, so the list
   * here has something in it.
   */
  it("opens the grouping editor on the album it is drilled into", async () => {
    const bar = panel("Top albums").$("button.bar-list-row");
    await bar.waitForExist({ timeout: 30_000 });
    // An album row is the only top list whose label holds a second name: the
    // artist is a nested span inside it, so the label's text is both.
    const label = await bar.$(".bar-list-label").getText();
    const artist = await bar.$(".bar-list-secondary").getText();
    const album = label.slice(0, label.length - artist.length).trim();

    await bar.click();

    // Compared rather than matched: an album title is free text and
    // `(Deluxe Edition)` is a regular expression's idea of a group.
    const crumbs = browser.$(".stats-breadcrumb");
    await browser.waitUntil(async () => (await crumbs.getText()).includes(album), {
      timeout: 10_000,
      timeoutMsg: `the breadcrumb never named ${album}`,
    });

    await panel("Top albums").$(".//button[normalize-space()='Fix the grouping…']").click();
    const dialog = browser.$(".dialog");
    await dialog.waitForExist({ timeout: 10_000 });
    await expect(dialog.$("h2")).toHaveText("How this album is grouped");
    // The spellings the fold put under this heading, which is what the
    // dialog is for and what the screenshot is of.
    await browser.waitUntil(async () => (await dialog.$$(".dialog-list li").length) > 1, {
      timeout: 10_000,
      timeoutMsg: "the group's spellings never arrived",
    });

    await capture("statistics-album-grouping");

    await dialog.$(".//button[normalize-space()='Cancel']").click();
    await expect(dialog).not.toBeExisting();

    // Out of the album again, so the specs below find the tab where the
    // artist drill left it.
    await browser.$("button[aria-label='Back']").click();
    await expect(panel("Top albums").$("button.bar-list-row")).toBeExisting();
  });

  it("counts the library on the other tab", async () => {
    await browser.$("//button[@role='tab'][normalize-space()='Library']").click();

    const tiles = browser.$(".stat-tiles");
    await tiles.waitForExist({ timeout: 10_000 });
    // The seeded library, through `stats_library_totals` rather than through
    // the count under the table.
    await expect(browser.$("//div[@class='stat-tile'][dt[text()='Songs']]")).toBeExisting();

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
   *
   * **Driven from the table rather than from a slice**, which is not a
   * concession to the harness but the same thing the component says about
   * itself: `ChartFrame` makes the svg `role="img"`, so a path is reachable by
   * a pointer and nothing else, and the drill's real control is the button in
   * the table. WebDriver agrees by accident - `elementClick` aims at an
   * element's bounding-box centre, and the centre of a ring segment's box is
   * the hole, so clicking a slice here dispatches at a point no part of the
   * path occupies and the event lands on nothing.
   */
  it("drills into a genre and narrows the whole tab with it", async () => {
    const genres = panel("Genres");
    await browser.waitUntil(async () => (await genres.$$("path.chart-slice").length) > 1, {
      timeout: 30_000,
      timeoutMsg: "the genre donut never arrived",
    });
    // The geometry the screenshot is of: slices drawn, and at least one of
    // them marked as having a level below.
    await expect(genres.$("path.chart-slice[data-drills]")).toBeExisting();
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

    await genres.$(".//button[normalize-space()='Show as table']").click();
    await genres.$("button.chart-table-drill").click();

    await expect(browser.$(".stats-breadcrumb")).toBeExisting();
    await browser.waitUntil(async () => (await health.getText()) !== before, {
      timeout: 30_000,
      timeoutMsg: "the genre crumb never reached the other panels",
    });

    // Back to the ring for the photograph, which is what this panel is.
    await genres.$(".//button[normalize-space()='Show as chart']").click();
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

    const dialog = browser.$(".dialog");
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

  /**
   * Last, and it clears up after itself: the filters are stored, so a range
   * left set here would be the range every spec after this one opens on.
   */
  it("says what is filtered under the bar, and takes it back", async () => {
    await browser.$("[role='combobox'][aria-label='Range']").click();
    await browser.$("//*[@role='option'][normalize-space()='Last 12 months']").click();

    const token = browser.$(".filter-token");
    await token.waitForExist({ timeout: 10_000 });
    await expect(token).toHaveText("last 12 months");

    // The line and the bar above it in one frame, which is the thing 4b draws
    // and the reason this view is photographed at all.
    await capture("statistics-filter-tokens");

    await browser.$("button[aria-label='Clear last 12 months']").click();

    await expect(browser.$(".filter-token")).not.toBeExisting();
    await expect(browser.$("[role='combobox'][aria-label='Range']")).toHaveText("All time");
  });
});
