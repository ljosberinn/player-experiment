import { browser, expect } from "@wdio/globals";
import { capture, shotWidth } from "../screenshot";

/**
 * How the browse views lay themselves out, in an engine that has layout.
 *
 * Both subjects here are invisible to jsdom for the same reason: they are
 * about pixels. `BrowseView.test.tsx` proves the column arithmetic against a
 * stubbed `clientWidth` and a hand-fired `ResizeObserver`, which is the logic
 * but not the wiring - jsdom reports every element as zero-sized, so nothing
 * there can tell a grid that reflows from one that only appears to.
 *
 * Runs over the seeded library: three albums, three artists and three genres
 * is enough for a grid to have a column count and for a list to alternate.
 */

/** A library view in the sidebar, by its visible name. */
function view(name: string) {
  return browser.$(`//button[contains(@class,'sidebar-item')][normalize-space()='${name}']`);
}

/** How many rows the open browse view has rendered. */
function rowCount(): Promise<number> {
  return browser.execute(() => document.querySelectorAll(".browse-row").length);
}

/**
 * The stripe of each list row, top to bottom.
 *
 * Sorted by the row's own offset rather than taken in DOM order: the rows are
 * virtualized and absolutely positioned, so the document holds them in
 * whatever order the virtualizer last reused its keys in.
 */
function stripes(): Promise<boolean[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".browse-list .browse-row"))
      .map((row) => ({
        top: Number(/translateY\(([-\d.]+)px\)/.exec((row as HTMLElement).style.transform)?.[1]),
        odd: row.classList.contains("odd"),
      }))
      .sort((a, b) => a.top - b.top)
      .map((row) => row.odd),
  );
}

describe("browse layout", () => {
  let original: { width: number; height: number };

  before(async () => {
    original = await browser.getWindowSize();
  });

  after(async () => {
    await browser.setWindowSize(original.width, original.height);
    // The specs after this one expect the songs table, not a browse tab.
    await view("Songs").click();
    await expect(view("Songs")).toHaveAttribute("aria-current", "page");
  });

  it("reflows the album grid when the window is resized", async () => {
    await view("Releases").click();
    await browser.$(".browse-grid").waitForExist({ timeout: 10_000 });

    await browser.setWindowSize(1400, original.height);
    await browser.waitUntil(async () => (await rowCount()) === 1, {
      timeout: 10_000,
      timeoutMsg: "three albums should sit on one row in a wide window",
    });

    const wide = await capture("browse-albums-wide");

    // The bug this replaces: the column count was read off a ref during
    // render, so it was whatever the first measurement said and the grid kept
    // that many columns however narrow the window got.
    await browser.setWindowSize(700, original.height);
    await browser.waitUntil(async () => (await rowCount()) > 1, {
      timeout: 10_000,
      timeoutMsg: "the grid did not reflow when the window narrowed",
    });

    // Photographed at the window the assertion above ran against. Every other
    // capture grows to the review viewport first, which here would put the
    // albums back on one row before the shutter fired.
    const narrow = await capture("browse-albums-narrow", { ownWindow: true });

    // The one assertion any of these pictures carries. Nothing compares their
    // pixels, but a narrow shot that is not narrower than the wide one is a
    // photograph of the wrong window, and it shipped that way twice before
    // anybody looked at the dimensions.
    if (wide && narrow) {
      expect(shotWidth("browse-albums-narrow")).toBeLessThan(shotWidth("browse-albums-wide"));
    }
  });

  it("stripes the artist and genre lists", async () => {
    await browser.setWindowSize(original.width, original.height);

    for (const name of ["Artists", "Genres"]) {
      await view(name).click();
      await browser.$(".browse-list").waitForExist({ timeout: 10_000 });
      await browser.waitUntil(async () => (await rowCount()) === 3, {
        timeout: 10_000,
        timeoutMsg: `${name} should list the three the fixture seeds`,
      });

      // Alternating from the first row, the same as the songs table.
      await expect(await stripes()).toEqual([false, true, false]);

      await capture(`browse-${name.toLowerCase()}-striped`);
    }
  });
});
