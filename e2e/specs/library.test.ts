import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { contrast, flatten, GRAPHIC_MINIMUM, TEXT_MINIMUM } from "../contrast";
import { LIBRARY, writeLibrary } from "../fixtures";
import { invoke } from "../invoke";
import { chooseFromMenu } from "../menu";

/**
 * The suite that has rows in it.
 *
 * Every other spec runs against an empty library, which is most of why the
 * defects that reached a user were the ones on a row: the playing marker, the
 * selected row, the status column. `App.css.test.ts` reads those rules as
 * text and `SongTable.test.tsx` renders them in jsdom, where no stylesheet
 * applies - so between them, nothing had ever *looked* at a row.
 *
 * The library here is real: six generated mp3 files, walked by the real
 * scanner, read back out of SQLite through the real query path. Two things
 * are not real, both because a CI runner is not a desktop: the app data
 * directory (each spec file gets its own, so this one seeding six tracks does
 * not break the spec that asserts on an empty library) and the audio sink (a
 * runner has no sound card, and with the shipped fallback every load fails, so
 * no row could ever be shown playing). Both are set in `wdio.conf.ts` and both
 * are read only by a build carrying the `wdio` feature.
 */

/**
 * One row, addressed by its place in the current order.
 *
 * By `aria-rowindex` rather than by position in a `$$` result: the rows are
 * virtualized, so they are absolutely positioned and the virtualizer reuses
 * keys - after a re-sort, DOM order is not screen order and neither is the
 * order of the query result. `aria-rowindex` is the index into the query,
 * which is the thing every assertion here actually means.
 */
function row(index: number) {
  return browser.$(`tr.song-row[aria-rowindex='${index + 1}']`);
}

/** Every row on screen, in the order the table puts them. */
function rows(): Promise<{ title: string; time: string; artist: string; album: string }[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll("tr.song-row"))
      .sort(
        (a, b) =>
          Number(a.getAttribute("aria-rowindex") ?? 0) -
          Number(b.getAttribute("aria-rowindex") ?? 0),
      )
      .map((one) => {
        const cells = Array.from(one.querySelectorAll("td.song-cell:not(.status)")).map(
          (cell) => cell.textContent ?? "",
        );
        return {
          title: cells[0] ?? "",
          time: cells[1] ?? "",
          artist: cells[2] ?? "",
          album: cells[3] ?? "",
        };
      }),
  );
}

/**
 * Sorts by a column the way a user does, and waits for the table to say so.
 *
 * Clicks until the header reports the direction asked for, rather than once:
 * the header *toggles*, so a single click on a column already sorted that way
 * turns it round. Written the naive way first, and it failed exactly there -
 * the second test to ask for title-ascending got title-descending and then
 * waited ten seconds for an attribute that was never coming.
 *
 * Two clicks is the most it can ever need: one to reach the column, one to
 * turn it round. A third means the header is not toggling at all, and saying
 * so is more use than looping.
 */
async function sortBy(column: string, expected: "ascending" | "descending"): Promise<void> {
  const header = () => browser.$(`th[data-column='${column}']`);

  for (let attempt = 0; attempt < 2; attempt++) {
    if ((await header().getAttribute("aria-sort")) === expected) {
      return;
    }
    await browser.$(`th[data-column='${column}'] button`).click();
    // Settles before the next look: the sort is a round trip to SQLite, so the
    // attribute changes a moment after the click rather than with it.
    await browser
      .waitUntil(async () => (await header().getAttribute("aria-sort")) === expected, {
        timeout: 15_000,
      })
      .catch(() => undefined);
  }

  const reached = await header().getAttribute("aria-sort");
  if (reached !== expected) {
    throw new Error(`the ${column} column reports ${reached}, not ${expected}`);
  }
}

/**
 * The colour of something on a row, and of everything painted behind it.
 *
 * The background is resolved by walking the ancestors rather than being named:
 * a selected row paints its own wash, an odd row paints another, and a plain
 * row paints nothing at all and shows the surface behind it. Naming one by hand
 * is how the first version of the appearance suite produced a false positive.
 *
 * Every layer, not the first: since phase 33 a selected row is an 18% accent
 * wash, so the fill it paints is not the colour anything on it is read against.
 * `flatten` composites the stack in the test process, where the parser that
 * understands both `rgb()` and `oklch()` lives.
 */
function colours(selector: string): Promise<{ text: string; behind: string } | null> {
  return browser.execute((sel: string) => {
    const element = document.querySelector(sel);
    if (element === null) {
      return null;
    }
    let painter: Element | null = element;
    const stack: string[] = [];
    while (painter !== null) {
      const fill = getComputedStyle(painter).backgroundColor;
      if (fill !== "" && fill !== "rgba(0, 0, 0, 0)" && fill !== "transparent") {
        stack.push(fill);
      }
      painter = painter.parentElement;
    }
    return { text: getComputedStyle(element).color, behind: JSON.stringify(stack) };
  }, selector);
}

/**
 * What the app thinks is playing, for a failure message.
 *
 * Built only when the wait below has already failed. "No row is marked
 * playing" has at least four causes - the double-click never reached React,
 * the command was rejected, the file would not load, or the marker is not
 * wired to the state - and they are indistinguishable from the outside. Each
 * of the four leaves a different trace here.
 */
async function describePlayback(): Promise<string> {
  const safe = async <T>(label: string, read: () => Promise<T>): Promise<string> => {
    try {
      return `${label}=${JSON.stringify(await read())}`;
    } catch (cause) {
      return `${label}=<threw ${String(cause)}>`;
    }
  };

  const parts = await Promise.all([
    // The backend's own answer: status, the track it holds, and how long the
    // queue is. A queue of zero means the command never arrived.
    safe("snapshot", () => invoke("player_snapshot")),
    // A load failure arrives on `player://error` and lands here. On a runner
    // that fell back to the shipped sink this reads "no audio output device",
    // which would mean the silent-sink variable never reached the app.
    safe("errorPopup", () =>
      browser.execute(() => document.querySelector(".error-popup")?.textContent ?? ""),
    ),
    safe("statusTitle", () =>
      browser.execute(() => document.querySelector(".now-playing-title")?.textContent ?? ""),
    ),
    // A selected row proves the double-click reached React at all: activating
    // a row selects it on the way past.
    safe("rowClasses", () =>
      browser.execute(() =>
        Array.from(document.querySelectorAll("tr.song-row")).map((one) => one.className),
      ),
    ),
  ]);

  return `no row is marked playing: ${parts.join(" ")}`;
}

/**
 * Plays row `index`, and waits for the marker.
 *
 * The click is real and the double-click is dispatched, which is not the
 * shape anyone would choose. `element.doubleClick()` goes through the Actions
 * API, and against this driver its two presses did not coalesce into a
 * `dblclick` at all: the diagnostic below reported the row *selected* - so the
 * click half had reached React - beside a backend whose queue was still empty.
 * The activation event simply never happened.
 *
 * Dispatching it is proven in this file: the shift-click above reaches React's
 * delegated handler the same way, and does so on CI. So the row is clicked for
 * real, which is what selects and focuses it, and then told to activate.
 */
async function playRow(index: number): Promise<void> {
  await row(index).click();
  await browser.execute((rowIndex: number) => {
    document
      .querySelector(`tr.song-row[aria-rowindex='${rowIndex}']`)
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }, index + 1);
  // The marker is not an optimistic flip in the store: it comes back on
  // `player://state` after the player thread has loaded the file the row
  // named, so waiting for it waits for the whole round trip.
  try {
    await browser.$("tr.song-row.playing").waitForExist({ timeout: 30_000 });
  } catch {
    // Built after the wait rather than before, so it reports the state at the
    // moment of failure.
    throw new Error(await describePlayback());
  }
}

const BY_TITLE = [...LIBRARY].sort((a, b) => a.title.localeCompare(b.title));

describe("a library with something in it", () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
      timeout: 30_000,
      interval: 500,
    });

    // Checked before anything is written: it proves the data directory really
    // is this spec's own. If the override stopped being honoured, every
    // assertion below would run against whatever library the machine already
    // had, and would fail about counts rather than about the cause.
    await expect(browser.$(".empty-state")).toHaveText(/No songs yet/);

    const root = join(import.meta.dirname, "..", ".tmp", "library");
    writeLibrary(root);

    await invoke("add_watch_folder", { path: root });

    // From here it is the app's own path: File ▸ Rescan runs the scan and
    // refreshes the view when it finishes.
    await chooseFromMenu("File", "Rescan");
    await browser.waitUntil(
      async () => (await browser.$$("tr.song-row").length) === LIBRARY.length,
      { timeout: 60_000, timeoutMsg: `the scan never produced ${LIBRARY.length} rows` },
    );
  });

  it("puts what the scanner read into the rows", async () => {
    await sortBy("title", "ascending");

    // Whole rows at once: a per-cell assertion reports the first difference
    // and hides the rest, and the failure worth seeing here is a column that
    // shifted rather than a single value that changed.
    expect(await rows()).toEqual(
      BY_TITLE.map((track) => ({
        title: track.title,
        time: track.time,
        artist: track.artist,
        album: track.album,
      })),
    );
  });

  it("counts what it ingested, and leaves alone what is not audio", async () => {
    // The fixture folder also holds a .jpg and a .txt, so "6 songs" is as much
    // an assertion about those two as about the six mp3s.
    await expect(browser.$(".statusbar-summary")).toHaveText(
      new RegExp(`^${LIBRARY.length} songs`),
    );
  });

  it("sorts by a column, both ways", async () => {
    await sortBy("artist", "ascending");
    const ascending = (await rows()).map((one) => one.artist);
    expect(ascending).toEqual([...ascending].sort((a, b) => a.localeCompare(b)));
    // The fixtures are chosen so artist order is not title order, which is
    // what the table was left in above - otherwise this would pass without
    // the click having done anything.
    expect(ascending[0]).toBe("Alto Field");

    await sortBy("artist", "descending");
    expect((await rows()).map((one) => one.artist)).toEqual([...ascending].reverse());
  });

  it("extends a selection with shift, and stops at the anchor", async () => {
    await sortBy("title", "ascending");
    await row(0).click();
    await expect(browser.$("tr.song-row[aria-selected='true']")).toBeExisting();

    // Dispatched rather than driven through `performActions`: holding a
    // modifier across a click needs the Actions API, which this driver is an
    // embedded Tauri plugin rather than a full implementation of. React's
    // listener is on the root and this bubbles to it, so the handler under
    // test sees exactly the event it would see from a real shift-click.
    await browser.execute((index: number) => {
      document
        .querySelector(`tr.song-row[aria-rowindex='${index + 1}']`)
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    }, 2);

    expect(await browser.$$("tr.song-row[aria-selected='true']").length).toBe(3);
  });

  it("marks the row it is playing, and says so in the status display", async () => {
    await sortBy("title", "ascending");
    await playRow(0);

    await expect(browser.$(".now-playing-title")).toHaveText(BY_TITLE[0]?.title ?? "");
    await expect(browser.$("tr.song-row.playing .row-status.playing")).toBeExisting();
    // The marker is on the row that was activated, not merely on some row.
    expect(await browser.$("tr.song-row.playing").getAttribute("aria-rowindex")).toBe("1");
  });

  /* One theme since phase 33: the app is dark only, so what made this loop -
     a runner that boots light while the defects were dark-only - no longer
     applies. The colours are still measured; there is one pass of it. */
  describe("in the one theme there is", () => {
    beforeEach(async () => {
      await sortBy("title", "ascending");
    });

    it("keeps the playing marker visible whether or not the row is selected", async () => {
      // The defect this exists for: `.row-status.playing` is `--accent` and
      // `.song-row.selected` is *filled* with `--accent`. Activating a row
      // both plays and selects it, so the marker was accent on accent -
      // invisible until the selection moved off it. It shipped. No unit test
      // could have caught it: jsdom resolves no colours at all.
      await playRow(0);

      const onSelection = await colours("tr.song-row.playing.selected .row-status.playing");
      // Moved off, where the marker takes `--accent` back and sits on the
      // row's ordinary fill instead.
      await row(3).click();
      const alone = await colours("tr.song-row.playing:not(.selected) .row-status.playing");

      // Both states collected before either is judged, so a failure names
      // whichever of them is wrong instead of stopping at the first.
      const faint = [
        { where: "on the selected row", measured: onSelection },
        { where: "with the selection elsewhere", measured: alone },
      ]
        .map((state) => ({
          ...state,
          ratio:
            state.measured === null
              ? 0
              : contrast(state.measured.text, flatten(JSON.parse(state.measured.behind))),
        }))
        .filter((state) => state.ratio < GRAPHIC_MINIMUM)
        .map((state) =>
          state.measured === null
            ? `${state.where}: no marker found`
            : `${state.where}: ${state.measured.text} on ${flatten(JSON.parse(state.measured.behind))} = ${state.ratio.toFixed(2)}:1`,
        );

      expect(faint).toEqual([]);
    });

    it("keeps every row's own text legible", async () => {
      // One selected, so the run covers the plain row, the odd row and the
      // filled one - three different backgrounds, which is where a colour
      // pair that works in one theme and collapses in the other shows up.
      await row(1).click();

      const measured = await browser.execute(() =>
        Array.from(document.querySelectorAll("tr.song-row")).flatMap((one) => {
          const cell = one.querySelector("td.song-cell:not(.status)");
          if (cell === null) {
            return [];
          }
          // Every fill up to the root, not the first one found. A selected
          // row is an 18% accent wash since phase 33, so what the row paints
          // is not the colour its text is read against; `flatten` composites
          // the stack out in the test process.
          let painter: Element | null = cell;
          const stack: string[] = [];
          while (painter !== null) {
            const fill = getComputedStyle(painter).backgroundColor;
            if (fill !== "" && fill !== "rgba(0, 0, 0, 0)" && fill !== "transparent") {
              stack.push(fill);
            }
            painter = painter.parentElement;
          }
          return [
            {
              // Named by what the row *is*, so a failure reads "selected" or
              // "odd" rather than an index into a virtualized list that means
              // nothing by the time anybody reads it.
              where: one.className.replace("song-row", "").trim() || "plain",
              text: getComputedStyle(cell).color,
              behind: stack.length === 0 ? "" : JSON.stringify(stack),
            },
          ];
        }),
      );

      expect(measured.length).toBe(LIBRARY.length);

      const illegible = measured
        .filter((one) => one.behind !== "")
        .map((one) => ({ ...one, ratio: contrast(one.text, flatten(JSON.parse(one.behind))) }))
        .filter((one) => one.ratio < TEXT_MINIMUM)
        .map(
          (one) =>
            `${one.where}: ${one.text} on ${flatten(JSON.parse(one.behind))} = ${one.ratio.toFixed(2)}:1`,
        );

      expect(illegible).toEqual([]);
    });
  });
});
