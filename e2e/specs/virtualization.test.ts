import { browser, expect } from "@wdio/globals";
import { invoke } from "../invoke";

/**
 * The claim the whole design rests on, checked against the real engine.
 *
 * The premise: a library of tens of thousands of tracks must stay
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
 * The **performance** claim is one, and it is a *ratio*: a cold page at the far
 * end of the ordering must not cost *disproportionately* more than a cold page
 * at the near end. A ratio measures the app rather than the runner, which an
 * absolute budget on a shared CI box cannot.
 *
 * It is worth saying what the first instrumented runs actually showed, because
 * it is not "no difference". A near page landed in 454-482ms and a far page in
 * 528-1095ms, debug build, end to end. Deep paging *is* more expensive - the
 * query is `LIMIT ? OFFSET ?` and `OFFSET` walks the index to get there, so
 * cost does grow with depth. What the numbers say is that it grows by a small
 * constant factor over a very cheap operation, not by orders of magnitude, and
 * that the run-to-run spread on a shared runner is as wide as the effect being
 * measured. Both facts are why the bound is loose and why the numbers are
 * printed: a single run is one sample, and the log is where the trend lives.
 *
 * The first version of this file asserted ceilings of ten and fifteen seconds
 * and printed nothing. That was worth very little: a ceiling loose enough to
 * survive a noisy runner only catches a total collapse, and a run that printed
 * no numbers could not tell anyone that a page which used to land in 40ms now
 * takes 900. Every timing is now recorded and printed at the end of the spec,
 * because the log is where a trend lives.
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
    // 25ms, not the 500ms default: the interval is the resolution of every
    // measurement below, and at 500ms a page that took 40ms and one that took
    // 400ms are the same number.
    { timeout, interval: 25, timeoutMsg: `row ${index} never arrived with its data` },
  );
}

/**
 * Every timing taken during the run, printed together at the end.
 *
 * The first version of this spec asserted ceilings and printed nothing, so a
 * green run said "not catastrophically broken" and stopped there. A number in
 * the log is what makes a run worth reading: it is the only way anyone notices
 * a page that used to land in 40ms now taking 900, which no ceiling loose
 * enough to survive a shared runner will ever catch.
 */
const measurements: [string, number][] = [];

/** Runs `work`, records how long it took, and hands the number back. */
async function timed(label: string, work: () => Promise<unknown>): Promise<number> {
  const started = Date.now();
  await work();
  const elapsed = Date.now() - started;
  measurements.push([label, elapsed]);
  return elapsed;
}

/**
 * Re-sorts, which is the app's own way of throwing every cached page away.
 *
 * A measurement taken against a warm cache measures the cache. There is no
 * back door for emptying it - and there should not be - so this uses the one
 * the UI already has: a new sort changes the query token, and every page held
 * against the old one is dropped.
 */
async function dropThePageCache(): Promise<void> {
  const before = await browser.$("th[data-column='title']").getAttribute("aria-sort");
  await browser.$("th[data-column='title'] button").click();
  await browser.waitUntil(
    async () => (await browser.$("th[data-column='title']").getAttribute("aria-sort")) !== before,
    { timeout: 30_000, timeoutMsg: "the title column never changed its sort" },
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
    await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
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

  after(() => {
    // Printed rather than asserted. The CI log is where a trend lives: these
    // are the numbers to compare a run against the last one, and none of them
    // has a threshold worth failing a build over on a shared machine.
    const report = measurements
      .map(([label, ms]) => `  ${label.padEnd(28)} ${String(ms).padStart(6)}ms`)
      .join("\n");
    console.log(`\n  ${existing + ROWS} rows, measured:\n${report}\n`);
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

  it("reaches the last row at all", async () => {
    await scrollTo("bottom");
    await waitForRealRow(existing + ROWS, 30_000);

    // The row at the far end is where a page cache keyed on the wrong thing
    // quietly returns the first page again, and where a naive `OFFSET` starts
    // to hurt. Reaching it with its data is the structural half of that; the
    // cost of reaching it is measured separately below.
    await expect(browser.$(`tr.song-row[aria-rowindex='${existing + ROWS}']`)).toBeExisting();
  });

  it("still holds only a windowful at the far end", async () => {
    // Asserted after the scroll as well as before it, because the failure this
    // is really about is a virtualizer that keeps every row it has ever
    // rendered - which looks perfect until something has scrolled.
    expect(await renderedRows()).toBeLessThan(MAX_RENDERED);
  });

  it("costs the same at the far end as at the near end", async () => {
    // The one assertion here that is about performance rather than structure,
    // and it is a **ratio** rather than a budget on purpose.
    //
    // An absolute budget measures the runner, not the app: on a shared CI box
    // it has to be set an order of magnitude loose to avoid flaking, and by
    // then it only catches a total collapse. A ratio cancels the runner out.
    // Both pages are fetched cold, both are one page of a hundred and fifty
    // thousand rows, and the only difference between them is how far into the
    // ordering they sit - which is precisely the thing that degrades if the
    // query stops using an index, or if paging is ever done by walking.
    //
    // If deep paging went linear, the far page would not be 3x the near one,
    // it would be hundreds of times, and this fails while a 10-second ceiling
    // would still pass.
    await dropThePageCache();

    await scrollTo("top");
    const near = await timed("first page, cold", () => waitForRealRow(1, 30_000));

    await scrollTo("bottom");
    const far = await timed("last page, cold", () => waitForRealRow(existing + ROWS, 30_000));

    // Observed on the runner, in a debug build, over two runs: a near page at
    // 454-482ms and a far page at 528-1095ms. So the far page does cost more -
    // `OFFSET` walks the index, and walking 150,000 entries is not free - but
    // it costs about 2x, not 100x, and the run-to-run spread is as wide as the
    // effect. Those numbers are why the multiplier is 5 and why the floor is
    // 2.5s: both sit above the noise and far below a collapse.
    //
    // A tighter bound would be measuring this runner's mood. The failure worth
    // catching is paging that walks *rows* instead of index entries, and that
    // is three orders of magnitude away, not thirty percent.
    expect(far).toBeLessThan(Math.max(near * 5, 2_500));
  });

  it("sorts a library this size without losing the window", async () => {
    // A fresh query, a fresh count and a dropped page cache, all at 150k rows.
    // It is also the operation most likely to be accidentally done in Rust
    // over every row instead of in SQL over an index.
    //
    // Back to the top first, and not for tidiness: the test before this one
    // leaves the table at the far end, and row 1 is then a hundred and fifty
    // thousand rows above the viewport - so waiting for it to render was
    // waiting for something virtualization is *supposed* to withhold. The
    // first version failed exactly there, which was the assertion working
    // rather than the app.
    await scrollTo("top");
    await timed("re-sort, to first painted row", async () => {
      await dropThePageCache();
      await waitForRealRow(1, 30_000);
    });

    expect(await rowCount()).toBe(existing + ROWS);
    expect(await renderedRows()).toBeLessThan(MAX_RENDERED);
  });

  it("jumps into the middle without walking there", async () => {
    // A scrollbar drag lands somewhere nobody has been. Nothing may have been
    // fetched on the way, so this is the page cache being asked for a range it
    // has never seen rather than one adjacent to what it holds.
    await scrollTo("top");
    await dropThePageCache();

    // Cold, and deliberately so. The first version of this measured 7ms, which
    // is not a fetch - it is a cache hit left over from the sweep before it,
    // and a number that fast in a perf log is worse than no number, because it
    // reads as evidence.
    const target = Math.floor((existing + ROWS) / 2);
    await scrollTo(target * 26);

    await timed("middle page, cold", () => waitForRealRow(target, 30_000));
    expect(await renderedRows()).toBeLessThan(MAX_RENDERED);
  });
});
