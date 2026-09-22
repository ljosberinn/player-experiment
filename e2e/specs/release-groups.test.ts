import { browser, expect } from "@wdio/globals";
import { capture } from "../screenshot";

/**
 * A drill-in drawn as release groups, in an engine that has layout.
 *
 * `ReleaseGroups.test.tsx` proves what the component renders; it cannot prove
 * any of what is below, because jsdom reports every element as zero-sized and
 * the whole design of this view rests on sizes. Three claims in particular are
 * arithmetic the app performs rather than measures, and each is wrong silently:
 *
 * - a group is `28n + 58` tall, which is what lets the virtualizer place every
 *   group before a single row of it has been fetched;
 * - the gutter never decides that height, which is only true because the cover
 *   sits beside its labels rather than above them;
 * - the one column header lines up with every group's table, which is a
 *   `calc()` in the sheet agreeing with a `grid-template-columns` in it.
 *
 * The fixture seeds three albums of two tracks, so `n` is 2 and a group is 114.
 */

/** A library view in the sidebar, by its visible name. */
function view(name: string) {
  return browser.$(`//button[contains(@class,'sidebar-item')][normalize-space()='${name}']`);
}

/** The box of the first element matching `selector`, in viewport coordinates. */
function box(selector: string): Promise<{ top: number; left: number; height: number }> {
  return browser.execute((one) => {
    const found = document.querySelector(one);
    if (found === null) {
      return { top: -1, left: -1, height: -1 };
    }
    const rect = found.getBoundingClientRect();
    return { top: rect.top, left: rect.left, height: rect.height };
  }, selector);
}

describe("a drill-in drawn as release groups", () => {
  before(async () => {
    await view("Releases").click();
    await browser.$(".browse-grid").waitForExist({ timeout: 10_000 });
    await browser.$("//button[contains(@class,'browse-tile')][.//text()='Harbour']").click();
    await browser.waitUntil(async () => (await browser.$$("tr.song-row").length) === 2, {
      timeout: 15_000,
      timeoutMsg: "the Harbour drill-in never landed its two rows",
    });
  });

  after(async () => {
    // The specs after this one expect the songs table, not a drill-in.
    await view("Songs").click();
    await expect(view("Songs")).toHaveAttribute("aria-current", "page");
  });

  it("draws the release in a gutter beside its rows", async () => {
    await expect(browser.$(".release-gutter")).toBeExisting();
    // The album, its year and its format line - the three the gutter carries
    // that a grid tile does not.
    await expect(browser.$(".release-title")).toHaveText("Harbour");
    await expect(browser.$(".release-format")).toHaveText(expect.stringContaining("MP3"));

    await capture("release-group-drill-in");
  });

  it("is exactly as tall as the arithmetic says", async () => {
    // 14 + 14 padding, three 28px rows (two tracks and the closing row), and
    // the 2px rule. If this drifts, the virtualizer places every group after
    // the first at the wrong offset and the view tears as it scrolls.
    await expect((await box(".release-group")).height).toBe(114);
  });

  it("never lets the gutter decide the height", async () => {
    const group = await box(".release-group");
    const gutter = await box(".release-gutter");

    // The claim the 52px cover rests on: stacked above its labels the gutter
    // would be taller than a group of one track, and `groupHeight` - which
    // knows nothing about the gutter - would be short for every such group.
    expect(gutter.height).toBeLessThanOrEqual(group.height - 28);
  });

  it("lines the one column header up with every group's table", async () => {
    const header = await box(".release-header-table th[data-column='title']");
    const cell = await box(".release-group td.song-cell[data-column='title']");

    // One header stands for all the groups, so it is inset by the gutter
    // rather than repeated per group. The inset is a `calc()` of the same
    // three numbers the group's grid is built from; this is the two agreeing.
    expect(Math.abs(header.left - cell.left)).toBeLessThanOrEqual(1);
  });
});
