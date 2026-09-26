import { browser, expect } from "@wdio/globals";
import { LIBRARY } from "../fixtures";
import { capture } from "../screenshot";

/**
 * The MusicBrainz column, over files a real scan read the release id from.
 *
 * `columns.test.ts` proves the cell's text from a hand-built `Track`; this is
 * the id travelling from a TXXX frame through `lofty`, the scan and the row
 * query to the screen. It also leaves the column hidden and the sort as it
 * found them, since the specs after it share the Songs view's layout.
 */

const TAGGED = LIBRARY.filter((track) => track.releaseMbid !== undefined).map((t) => t.title);

/** Each row's title and MusicBrainz cell, in the order the table puts them. */
function cells(): Promise<{ title: string; mark: string }[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll("tr.song-row"))
      .sort(
        (a, b) =>
          Number(a.getAttribute("aria-rowindex") ?? 0) -
          Number(b.getAttribute("aria-rowindex") ?? 0),
      )
      .map((one) => {
        const cell = (column: string) =>
          (one.querySelector(`td.song-cell[data-column='${column}']`)?.textContent ?? "").trim();
        return { title: cell("title"), mark: cell("releaseMbid") };
      }),
  );
}

/**
 * Opens the header's column menu and picks the MusicBrainz entry, which shows
 * or hides the column.
 *
 * A dispatched `contextmenu` for the reason `smart-playlists.test.ts` gives:
 * the Actions API's right click produces none against this driver.
 */
async function toggleColumn(): Promise<void> {
  await browser.execute(() => {
    const row = document.querySelector("th[data-column='title']")?.closest("tr");
    if (row == null) {
      return;
    }
    const box = row.getBoundingClientRect();
    row.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: Math.round(box.left + box.width / 2),
        clientY: Math.round(box.top + box.height / 2),
      }),
    );
  });
  await browser.$("//*[@role='menuitem'][contains(., 'MusicBrainz')]").click();
}

/** The column the view is sorted by, and which way. */
function currentSort(): Promise<{ column: string; direction: string } | null> {
  return browser.execute(() => {
    const header = document.querySelector("th[aria-sort='ascending'], th[aria-sort='descending']");
    if (header === null) {
      return null;
    }
    return {
      column: header.getAttribute("data-column") ?? "",
      direction: header.getAttribute("aria-sort") ?? "",
    };
  });
}

/** Clicks `column`'s header until it reports `direction`; at most twice. */
async function sortBy(column: string, direction: string): Promise<void> {
  const header = () => browser.$(`th[data-column='${column}']`);
  for (let attempt = 0; attempt < 2; attempt++) {
    if ((await header().getAttribute("aria-sort")) === direction) {
      return;
    }
    await browser.$(`th[data-column='${column}'] button`).click();
    await browser
      .waitUntil(async () => (await header().getAttribute("aria-sort")) === direction, {
        timeout: 15_000,
      })
      .catch(() => undefined);
  }
  await expect(header()).toHaveAttribute("aria-sort", direction);
}

describe("the MusicBrainz column", () => {
  let found: { column: string; direction: string } | null = null;

  it("shows through the header menu", async () => {
    await browser.$("tr.song-row").waitForExist({ timeout: 30_000 });
    found = await currentSort();

    await toggleColumn();
    await browser.$("th[data-column='releaseMbid']").waitForExist({ timeout: 10_000 });
  });

  it("marks the songs carrying a release id and leaves the rest blank", async () => {
    await browser.waitUntil(async () => (await cells()).some((row) => row.mark !== ""), {
      timeout: 10_000,
      timeoutMsg: "no row ever carried a mark",
    });

    for (const { title, mark } of await cells()) {
      expect(mark).toBe(TAGGED.includes(title) ? "✓" : "");
    }
  });

  it("sorts the tagged songs together, ahead of the untagged either way", async () => {
    // NULLs sort last in both directions, so the tagged rows lead both times.
    for (const direction of ["ascending", "descending"]) {
      await sortBy("releaseMbid", direction);
      const leading = (await cells()).slice(0, TAGGED.length).map((row) => row.title);
      expect(leading.slice().sort()).toEqual(TAGGED.slice().sort());
    }

    await sortBy("releaseMbid", "ascending");
    await capture("musicbrainz-column");
  });

  after(async () => {
    // Escape first, in case a failure left the menu open over the header.
    await browser.keys(["Escape"]);
    if (await browser.$("th[data-column='releaseMbid']").isExisting()) {
      await toggleColumn();
      await browser
        .$("th[data-column='releaseMbid']")
        .waitForExist({ reverse: true, timeout: 10_000 });
    }
    if (found !== null) {
      await sortBy(found.column, found.direction);
    }
  });
});
