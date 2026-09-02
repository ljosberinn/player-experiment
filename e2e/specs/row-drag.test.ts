import { browser, expect } from "@wdio/globals";
import { LIBRARY } from "../fixtures";
import { capture } from "../screenshot";

/**
 * Dragging rows, in a real webview.
 *
 * Since phase 74 this is the app's own gesture rather than the browser's, and
 * that is what makes it reachable here at all. A synthesized `DragEvent` could
 * only ever hand a stub `DataTransfer` to a handler with no OS drag loop behind
 * it - it proved the handler, and nothing about the drag. A dispatched
 * `PointerEvent` sequence runs the whole thing: recognition past the threshold,
 * the badge, hit-testing between two components, the indicators, and the drop.
 *
 * Dispatched rather than driven through `performActions`, which this driver -
 * an embedded Tauri plugin - does not implement. `library.test.ts` dispatches a
 * shift-click for the same reason.
 *
 * Runs after `library.test.ts`, which is what puts songs in the shared library:
 * there is nothing to drag out of an empty table. It leaves the library as it
 * found it - the playlist it makes is deleted again, because every spec after
 * this one shares the sidebar.
 */

/** What `createFrom` names a playlist a drop creates, before it is renamed. */
const NEW_PLAYLIST_NAME = "New Playlist";

/** How many rows the first drag carries. */
const DRAGGED = 2;

interface Box {
  x: number;
  y: number;
  bottom: number;
}

/** The centre of an element, and its bottom edge, in client coordinates. */
async function box(selector: string): Promise<Box> {
  const found = await browser.execute((sel: string) => {
    const element = document.querySelector(sel);
    if (element === null) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      bottom: Math.round(rect.bottom),
    };
  }, selector);

  if (found === null) {
    throw new Error(`${selector} is not on screen`);
  }
  return found;
}

/**
 * Dispatches one pointer event at a point on screen, to whatever is under it.
 *
 * Through `elementFromPoint` rather than at a named element, which is the whole
 * value of driving it this way: routing a mouse drag to whatever it is over is
 * exactly what the app now relies on, and aiming each event at the element that
 * ought to receive it would assume the answer. It also puts the badge under
 * test - it follows the pointer, and without `pointer-events: none` it would be
 * what every one of these hits.
 */
async function pointer(type: string, x: number, y: number): Promise<void> {
  await browser.execute(
    (kind: string, px: number, py: number) => {
      const target = document.elementFromPoint(px, py) ?? document.body;
      target.dispatchEvent(
        new PointerEvent(kind, {
          bubbles: true,
          cancelable: true,
          clientX: px,
          clientY: py,
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          buttons: kind === "pointerup" ? 0 : 1,
        }),
      );
    },
    type,
    x,
    y,
  );
}

/** Presses a row and drags far enough to be recognised, leaving the button down. */
async function beginDrag(from: Box): Promise<void> {
  await pointer("pointerdown", from.x, from.y);
  // Past `DRAG_THRESHOLD_PX` in one step: the threshold is four pixels, and how
  // many moves it takes to cross it is `trackDrag.test.ts`'s business.
  await pointer("pointermove", from.x, from.y + 20);
}

function row(index: number) {
  return browser.$(`tr.song-row[aria-rowindex='${index + 1}']`);
}

/** The titles on screen, in the order the table puts them. */
function titles(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll("tr.song-row"))
      .sort(
        (a, b) =>
          Number(a.getAttribute("aria-rowindex") ?? 0) -
          Number(b.getAttribute("aria-rowindex") ?? 0),
      )
      .map((one) => (one.querySelector("td.song-cell:not(.status)")?.textContent ?? "").trim()),
  );
}

function playlistItem(name: string) {
  return browser.$(`button.sidebar-item[aria-label='${name}']`);
}

function libraryView(label: string) {
  return browser.$(
    `//button[contains(@class,'sidebar-item')][.//span[normalize-space(.)='${label}']]`,
  );
}

async function settledAt(count: number, why: string): Promise<void> {
  await browser.waitUntil(async () => (await titles()).length === count, {
    timeout: 15_000,
    timeoutMsg: why,
  });
}

describe("dragging rows", () => {
  before(async () => {
    await browser.$(".statusbar-summary").waitForExist({ timeout: 30_000 });
    await settledAt(LIBRARY.length, "the library never settled");
  });

  it("carries a selection onto the sidebar and makes a playlist of it", async () => {
    await row(0).click();
    // Shift-click, dispatched: holding a modifier across a click needs the
    // Actions API. Same route, same reason, as `library.test.ts`.
    await browser.execute((index: number) => {
      document
        .querySelector(`tr.song-row[aria-rowindex='${index + 1}']`)
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    }, DRAGGED - 1);
    expect(await browser.$$("tr.song-row[aria-selected='true']").length).toBe(DRAGGED);

    await beginDrag(await box("tr.song-row[aria-rowindex='1']"));

    // A DOM element now rather than an OS drag image, so it can be asserted on
    // at all.
    const badge = await browser.$(".drag-badge");
    await badge.waitForExist({ timeout: 5_000, timeoutMsg: "no badge under the pointer" });
    await expect(badge).toHaveText(`${DRAGGED} songs`);

    const zone = await box("[data-testid='playlist-dropzone']");
    await pointer("pointermove", zone.x, zone.y);
    await expect(browser.$(".sidebar-dropzone")).toHaveElementClass("drop-target");

    await pointer("pointerup", zone.x, zone.y);

    // The songs land first and the rename follows, so what is being named is a
    // playlist that already holds something.
    const rename = await browser.$("input.sidebar-rename");
    await rename.waitForExist({ timeout: 10_000, timeoutMsg: "no rename after the drop" });
    await browser.keys(["Enter"]);

    await expect(playlistItem(NEW_PLAYLIST_NAME).$(".sidebar-count")).toHaveText(String(DRAGGED));
    await expect(browser.$(".drag-badge")).not.toBeExisting();
  });

  it("reorders the playlist it is dropped back into", async () => {
    await playlistItem(NEW_PLAYLIST_NAME).click();
    await settledAt(DRAGGED, "the playlist never opened");
    const before = await titles();

    // One row, not the two the sidebar drag left selected - reordering the
    // whole playlist within itself would change nothing and prove nothing.
    await row(0).click();
    const last = await box(`tr.song-row[aria-rowindex='${DRAGGED}']`);
    await beginDrag(await box("tr.song-row[aria-rowindex='1']"));
    // Below the midpoint of the last row, which is the only way to say "after
    // everything": a drop index is a boundary, not a row.
    await pointer("pointermove", last.x, last.bottom - 2);

    // Whether the insertion line is drawn at all is a question only a real
    // stylesheet answers.
    await expect(row(DRAGGED - 1)).toHaveElementClass("drop-after");

    await pointer("pointerup", last.x, last.bottom - 2);

    await browser.waitUntil(async () => (await titles())[DRAGGED - 1] === before[0], {
      timeout: 15_000,
      timeoutMsg: "the first row never moved to the end",
    });
  });

  it("abandons a drag on Escape, leaving the order alone", async () => {
    const before = await titles();
    const last = await box(`tr.song-row[aria-rowindex='${DRAGGED}']`);

    await row(0).click();
    await beginDrag(await box("tr.song-row[aria-rowindex='1']"));
    await pointer("pointermove", last.x, last.bottom - 2);
    await browser.keys(["Escape"]);

    await expect(browser.$(".drag-badge")).not.toBeExisting();
    await expect(row(DRAGGED - 1)).not.toHaveElementClass("drop-after");

    // The release still arrives - the button was down when Escape was pressed -
    // and must not be taken for a drop.
    await pointer("pointerup", last.x, last.bottom - 2);
    expect(await titles()).toEqual(before);
  });

  it("photographs the badge and the target it is over", async () => {
    await libraryView("Songs").click();
    await settledAt(LIBRARY.length, "the library never came back");

    await row(0).click();
    await beginDrag(await box("tr.song-row[aria-rowindex='1']"));
    const target = await box(`button.sidebar-item[aria-label='${NEW_PLAYLIST_NAME}']`);
    await pointer("pointermove", target.x, target.y);

    // Its own test, and the last one to touch a drag: `capture` resizes the
    // window for the shot, which moves everything the pointer was aimed at.
    // Nothing after this depends on where the drag was.
    await capture("row-drag");
    await browser.keys(["Escape"]);
  });

  after(async () => {
    // Whatever failed above, the pointer is not left down for the next spec.
    await pointer("pointerup", 1, 1);
    await browser.keys(["Escape"]);

    if (await playlistItem(NEW_PLAYLIST_NAME).isExisting()) {
      // Through the row's own menu, dispatched: `click({ button: "right" })`
      // goes through the Actions API and produces no `contextmenu` at all
      // against this driver. Same route as `smart-playlists.test.ts`.
      await browser.execute((name: string) => {
        const trigger = document.querySelector(`button.sidebar-item[aria-label='${name}']`);
        if (trigger === null) {
          return;
        }
        const rect = trigger.getBoundingClientRect();
        trigger.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            clientX: Math.round(rect.left + rect.width / 2),
            clientY: Math.round(rect.top + rect.height / 2),
          }),
        );
      }, NEW_PLAYLIST_NAME);
      await browser.$("//*[@role='menuitem'][normalize-space(.)='Delete']").click();
      await browser.$(".modal-actions .destructive").click();
      await playlistItem(NEW_PLAYLIST_NAME).waitForExist({ reverse: true, timeout: 10_000 });
    }

    // The specs share one library; leaving a playlist selected would hand the
    // next one a two-row view where it expects the whole of it.
    await libraryView("Songs").click();
  });
});
