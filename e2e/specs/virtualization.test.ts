import { browser, expect } from "@wdio/globals";
import { invoke } from "../invoke";

/**
 * The claim the whole design rests on, checked against the real engine.
 *
 * `PLAN.md` opens with it: a library of tens of thousands of tracks must stay
 * fast, and the way that is achieved is that **the DOM never holds the
 * library**. SQLite pages it, TanStack Virtual renders about forty rows, and
 * the count comes from a separate `COUNT(*)` so the scrollbar is right without
 * loading anything.
 *
 * Every part of that has been tested except the part a user would notice.
 * `tests/perf.rs` proves the *queries* stay cheap at ten thousand rows -
 * loosely, to catch a dropped index rather than to benchmark. `SongTable.test.tsx`
 * proves the virtualizer is wired up in jsdom, which has no layout and
 * therefore no scrolling: every row is 0px tall there, so the number rendered
 * is whatever the mock decided. Nothing has ever scrolled a large library in
 * an engine that lays it out.
 *
 * This does. A hundred and fifty thousand rows, inserted rather than scanned -
 * that many real files would be gigabytes and minutes to produce a worse test,
 * and what is under test here is the table, not ingest, which the seeded
 * library spec covers with real mp3s.
 *
 * # What is asserted, and what is not
 *
 * The **structural** claims are asserted strictly, because they are exact:
 * the row count reaches the far end, the DOM stays bounded, the last row is
 * real rather than a placeholder. Those cannot flake - they are true or the
 * design is broken.
 *
 * The **timing** claims are deliberately loose, an order of magnitude above
 * what the operation costs, because this runs on a shared CI runner where a
 * noisy neighbour can cost seconds. They are not a benchmark. They exist to
 * catch the failure that turns a paged query into a full scan or a windowed
 * render into a complete one, which costs orders of magnitude rather than
 * percent. A budget tight enough to measure a regression of 20% would fail on
 * a busy runner every other week, and a flaky perf test is one that gets
 * disabled.
 */

/** Rows to add. Chosen to be past any plausible page-cache window. */
const ROWS = 150_000;

/**
 * The most rows the table may ever have in the DOM at once.
 *
 * The virtualizer renders what fits plus twelve rows of overscan on each side;
 * at 26px per row a maximised window on a 4K runner is under a hundred. Two
 * hundred is far above that and still four orders of magnitude below the
 * library, so it fails only if virtualization has actually stopped happening -
 * which is exactly the regression worth catching, and the one a `key` change
 * or a stray `overflow: visible` can cause.
 */
const MAX_RENDERED = 200;

/** What the table says the library holds, from the ARIA contract. */
async function rowCount(): Promise<number> {
  const value = await browser.$("table.song-table").getAttribute("aria-rowcount");
  return Number(value ?? 0);
}

/** How many rows are actually in the document right now. */
function renderedRows(): Promise<number> {
  return browser.execute(() => document.querySelectorAll("tr.song-row").length);
}

/** Scrolls the table body to an absolute offset and lets the frame settle. */
async function scrollTo(position: "top" | "bottom" | number): Promise<void> {
  await browser.execute((where: string | number) => {
    const body = document.querySelector("[data-testid='song-scroll']");
    if (body === null) {
      return;
    }
    body.scrollTop =
      where === "bottom" ? body.scrollHeight : where === "top" ? 0 : (where as number);
  }, position);
}

/**
 * Waits until the row at `index` is on screen with its data, not a placeholder.
 *
 * A row whose page has not arrived renders a shimmer bar rather than blocking
 * the scroll, which is the right behaviour and also the thing that would let a
 * naive assertion pass while nothing had loaded. `.skeleton` is how the two are
 * told apart.
 */
async function waitForRealRow(index: number, timeout: number): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((rowIndex: number) => {
        const one = document.querySelector(`tr.song-row[aria-rowindex='${rowIndex}']`);
        return one !== null && one.querySelector(".skeleton") === null;
      }, index),
    { timeout, timeoutMsg: `row ${index} never arrived with its data` },
  );
}

describe("a library too big to put in the DOM", () => {
  /**
   * Rows the library already held.
   *
   * Not zero, and not named `before`: the suite shares one library and one app
   * process, so the specs before this one have left rows behind - and `before`
   * is Mocha's own hook, which is what the first draft shadowed.
   */
  let existing = 0;

  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()) === "Player", {
      timeout: 30_000,
      interval: 500,
    });

    existing = await rowCount();

    // Inserted rather than scanned, and only an e2e build will do it: the
    // command refuses in any build a user could install.
    const seeded = await invoke<number>("seed_synthetic_tracks", { count: ROWS });
    expect(seeded).toBe(ROWS);

    // The command emits `library://changed`, which is what the open view
    // listens to - so the count arriving is the round trip through the event,
    // the re-count and the re-render, not just the insert.
    await browser.waitUntil(async () => (await rowCount()) === existing + ROWS, {
      timeout: 120_000,
      timeoutMsg: `the table never reported ${existing + ROWS} rows`,
    });
  });

  it("knows how many rows it has without holding them", async () => {
    expect(await rowCount()).toBe(existing + ROWS);
    // The scrollbar is driven by the count, so the scroll extent is the other
    // half of the same claim: 150k rows at 26px is about 3.9 million pixels,
    // and a table that had materialised them would not have got this far.
    const extent = await browser.execute(
      () => document.querySelector("[data-testid='song-scroll']")?.scrollHeight ?? 0,
    );
    expect(extent).toBeGreaterThan(1_000_000);

    expect(await renderedRows()).toBeLessThan(MAX_RENDERED);
  });

  it("reaches the last row, and reaches it quickly", async () => {
    const started = Date.now();
    await scrollTo("bottom");
    await waitForRealRow(existing + ROWS, 30_000);
    const elapsed = Date.now() - started;

    // The row at the far end is the one a naive `OFFSET` degrades on: reaching
    // it means running past 149,999 index entries. It is also where a page
    // cache keyed on the wrong thing quietly returns the first page again.
    const last = await browser.$(`tr.song-row[aria-rowindex='${existing + ROWS}']`);
    await expect(last).toBeExisting();

    // Ten seconds for one page of a hundred and fifty thousand rows: an order
    // of magnitude above what it costs, so it fails on a broken query rather
    // than on a busy runner. See the note at the top.
    expect(elapsed).toBeLessThan(10_000);
  });

  it("still holds only a windowful at the far end", async () => {
    // Asserted after the scroll as well as before it, because the failure this
    // is really about is a virtualizer that keeps every row it has ever
    // rendered - which looks perfect until something has scrolled.
    expect(await renderedRows()).toBeLessThan(MAX_RENDERED);
  });

  it("sorts a library this size without losing the window", async () => {
    // The sort is a fresh query, a fresh count and a dropped page cache, all
    // at 150k rows. It is also the operation most likely to be accidentally
    // done in Rust over every row instead of in SQL over an index.
    const started = Date.now();
    await browser.$("th[data-column='title'] button").click();
    await browser.waitUntil(
      async () => (await browser.$("th[data-column='title']").getAttribute("aria-sort")) !== "none",
      { timeout: 30_000, timeoutMsg: "the title column never reported itself sorted" },
    );
    await waitForRealRow(1, 30_000);

    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await rowCount()).toBe(existing + ROWS);
    expect(await renderedRows()).toBeLessThan(MAX_RENDERED);
  });

  it("jumps into the middle without walking there", async () => {
    // A scrollbar drag lands somewhere nobody has been. Nothing may have been
    // fetched on the way, so this is the page cache being asked for a range it
    // has never seen rather than one adjacent to what it holds.
    await scrollTo("top");
    const target = Math.floor((existing + ROWS) / 2);
    await scrollTo(target * 26);

    const started = Date.now();
    await waitForRealRow(target, 30_000);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await renderedRows()).toBeLessThan(MAX_RENDERED);
  });
});
