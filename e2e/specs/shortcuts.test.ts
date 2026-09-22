import { browser, expect } from "@wdio/globals";
import { LIBRARY } from "../fixtures";
import { invoke } from "../invoke";

/**
 * Every key the app binds at the window, and the field that stands them down.
 *
 * `shortcutFor`, `libraryShortcutFor`, `historyShortcutFor`, `historyButtonFor`
 * and `zoomKey` each have their own unit test under `src/features`, and
 * `App.test.tsx` fires keydowns at jsdom. What none of them can see is the two
 * halves that matter here: that the listener is attached to `window` at all -
 * every one of these is a `useEffect` that could silently fail to run - and
 * that `isTypingTarget` hands the key back to the search box.
 *
 * Until this, F5 was the only key in the suite that was not Escape, Enter or
 * Backspace, and even that one is pressed on `body` alone.
 *
 * # Two per binding, except where the app means otherwise
 *
 * The second test of each pair is the one worth having: the same key, typed
 * into the search box, does not reach the app. Two bindings are deliberate
 * exceptions and are asserted as such rather than left out -
 * `useZoomShortcuts.ts` puts zoom outside the rule because "zoom is chrome,
 * not content", and `useHistoryShortcuts.ts` puts the side buttons outside it
 * because a thumb on a mouse button is unambiguous where a hand on the
 * keyboard is not. A spec written to the bare rule would fail against correct
 * code, which is most of why this one says the rule twice.
 *
 * # Pressed where pressing works, dispatched where it does not
 *
 * The bare keys are pressed for real, the way `library.test.ts` presses
 * ArrowDown and `menus.test.ts` presses F5. The chords are dispatched, for the
 * reason `row-menu.test.ts` dispatches Shift+F10: against this driver a
 * modifier chord is claimed by Windows or by the webview before the page sees
 * a keydown, and Alt+Arrow and Ctrl+plus are exactly the two it claims. What
 * survives the substitution is both halves above - a dispatched event with
 * `bubbles` still has to reach a listener on `window` to do anything, and it
 * still carries the `target` `isTypingTarget` reads. What stays uncovered is
 * whether the OS delivers the physical chord, which is the gap the media keys
 * already have.
 *
 * Runs after `row-menu.test.ts`: the selection keys need rows, and Delete
 * needs there to be no static playlist open - inside one it takes the
 * membership row with no confirmation at all, and `row-drag.test.ts` is what
 * makes the first playlist. Nothing here removes a song, changes a tag or
 * leaves the player running.
 */

const SEARCH = "input[aria-label='Search Library']";
/** The longest fixture, and the last row of the title-ascending order. */
const LONGEST = "Glass";

function row(index: number) {
  return browser.$(`tr.song-row[aria-rowindex='${index + 1}']`);
}

function searchBox() {
  return browser.$(SEARCH);
}

/**
 * Puts the caret in the search box, and waits until it is really there.
 *
 * The click alone is not enough to press a key against: it returns as soon as
 * the driver has dispatched it, and a key sent before the field has taken
 * focus goes to the window instead - which is the very thing every "in the
 * search box instead" test below is asserting does not happen. Waited out
 * against `document.activeElement` so that a key landing on the app is a
 * failure of the app rather than of the click.
 */
async function focusSearch(): Promise<void> {
  await searchBox().click();
  await browser.waitUntil(
    () =>
      browser.execute(
        (selector: string) => document.activeElement === document.querySelector(selector),
        SEARCH,
      ),
    { timeout: 10_000, timeoutMsg: "the search box never took the caret" },
  );
}

function snapshot(): Promise<{
  status: "stopped" | "playing" | "paused";
  track: { title: string } | null;
  positionMs: number;
}> {
  return invoke("player_snapshot");
}

/** A library view in the sidebar, by its visible name. */
function view(name: string) {
  return browser.$(`//button[contains(@class,'sidebar-item')][normalize-space()='${name}']`);
}

function selectedCount(): Promise<number> {
  return browser.execute(
    () => document.querySelectorAll("tr.song-row[aria-selected='true']").length,
  );
}

/**
 * A chord, as an event on `selector` rather than as a keypress.
 *
 * `bubbles` so it reaches the window listeners, `cancelable` so their
 * `preventDefault` has something to act on - a handler that calls it on an
 * uncancelable event throws in some engines and would fail as the wrong thing.
 */
async function dispatch(selector: string, init: Record<string, unknown>): Promise<void> {
  await browser.execute(
    (target: string, detail: Record<string, unknown>) => {
      document
        .querySelector(target)
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...detail }),
        );
    },
    selector,
    init,
  );
}

/**
 * A mouse side button, which is a `pointerdown` and not a `mouseup`.
 *
 * `useHistoryShortcuts.ts` binds `pointerdown` on purpose: Windows delivers
 * the side buttons through both it and `auxclick`, and by the time the click
 * arrives the browser has already decided nothing happened. An `auxclick` or a
 * `mouseup` here would assert nothing and read as a product bug.
 */
async function pressSideButton(selector: string, button: number): Promise<void> {
  await browser.execute(
    (target: string, which: number) => {
      document
        .querySelector(target)
        ?.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: which }),
        );
    },
    selector,
    button,
  );
}

/**
 * TEMPORARY, 123. Starts recording window keydowns, in both phases.
 *
 * The capture listener runs before the app's, the bubble one after all of
 * them, so the pair says both what the event arrived as and what the app did
 * to it. Paired with `takeRecordedKeys`, which is what removes them again.
 */
async function recordKeys(): Promise<void> {
  await browser.execute(() => {
    const scope = window as unknown as {
      __keyProbe?: { records: unknown[]; stop: () => void };
    };
    const records: unknown[] = [];
    const name = (node: EventTarget | null) => {
      const element = node as HTMLElement | null;
      return element?.tagName
        ? `${element.tagName}[${element.getAttribute("aria-label") ?? ""}]`
        : String(node);
    };
    const capture = (event: KeyboardEvent) => {
      records.push({
        phase: "capture",
        key: event.key,
        target: name(event.target),
        active: name(document.activeElement),
        prevented: event.defaultPrevented,
      });
    };
    const bubble = (event: KeyboardEvent) => {
      records.push({ phase: "bubble", key: event.key, prevented: event.defaultPrevented });
    };
    window.addEventListener("keydown", capture, true);
    window.addEventListener("keydown", bubble);
    scope.__keyProbe = {
      records,
      stop: () => {
        window.removeEventListener("keydown", capture, true);
        window.removeEventListener("keydown", bubble);
      },
    };
  });
}

/** TEMPORARY, 123. Reads what `recordKeys` saw, and unbinds it. */
async function takeRecordedKeys(): Promise<string> {
  return browser.execute(() => {
    const scope = window as unknown as {
      __keyProbe?: { records: unknown[]; stop: () => void };
    };
    const probe = scope.__keyProbe;
    probe?.stop();
    scope.__keyProbe = undefined;
    return JSON.stringify(probe?.records ?? null);
  });
}

/** Puts the search box back to empty, however this spec left it. */
async function clearSearch(): Promise<void> {
  const clear = browser.$("button[aria-label='Clear search']");
  if (await clear.isExisting()) {
    await clear.click();
  }
  await browser.waitUntil(async () => (await searchBox().getValue()) === "", {
    timeout: 10_000,
    timeoutMsg: "the search box never went back to empty",
  });
}

function zoomLabel(): Promise<string> {
  return browser.$(".statusbar-zoom-value").getText();
}

/**
 * Sorts by title ascending, the way `library.test.ts` does and for the same
 * reason: the header toggles, so one click on a column already sorted that way
 * turns it round.
 */
async function sortByTitle(): Promise<void> {
  const header = () => browser.$("th[data-column='title']");

  for (let attempt = 0; attempt < 2; attempt++) {
    if ((await header().getAttribute("aria-sort")) === "ascending") {
      return;
    }
    await browser.$("th[data-column='title'] button").click();
    await browser
      .waitUntil(async () => (await header().getAttribute("aria-sort")) === "ascending", {
        timeout: 15_000,
      })
      .catch(() => undefined);
  }

  const reached = await header().getAttribute("aria-sort");
  if (reached !== "ascending") {
    throw new Error(`the title column reports ${reached}, not ascending`);
  }
}

/**
 * Plays the last row, and waits for the player to say so.
 *
 * The same real-click-then-dispatched-dblclick `library.test.ts` explains at
 * length. The *last* row of the order deliberately: it is the longest fixture
 * at six seconds, and it is the end of the queue, so a track that plays out
 * while this spec is working stops rather than advancing to something else and
 * moving the assertions underneath it.
 *
 * Waited out against the player rather than against `tr.song-row.playing`. That
 * class marks the *current* track, not a running one: `Engine::stop` keeps its
 * index, because that is where Toggle resumes from, so the snapshot still names
 * the track and the row still wears the marker after a stop. Since this always
 * plays the same row, the marker left over from the last time is already there
 * and waiting for it returns before anything has loaded.
 */
async function playLastRow(): Promise<void> {
  const index = LIBRARY.length - 1;
  await row(index).click();
  await browser.execute((rowIndex: number) => {
    document
      .querySelector(`tr.song-row[aria-rowindex='${rowIndex}']`)
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }, index + 1);
  await browser.waitUntil(
    async () => {
      const player = await snapshot();
      return player.status === "playing" && player.track?.title === LONGEST;
    },
    { timeout: 30_000, timeoutMsg: `${LONGEST} never started playing` },
  );
}

async function waitForStatus(expected: "playing" | "paused" | "stopped"): Promise<void> {
  await browser.waitUntil(async () => (await snapshot()).status === expected, {
    timeout: 15_000,
    timeoutMsg: `the player never reported itself ${expected}`,
  });
}

/**
 * A paused player at the start of the longest fixture.
 *
 * Stopped and restarted rather than paused where it stands: these specs share
 * one process, so a test that failed halfway leaves the player wherever it got
 * to, and "wherever it got to" can be the end of a six-second track - where a
 * forward seek has nowhere to go and "the playhead moved" cannot be asserted
 * at all.
 *
 * Paused through the *button*, deliberately. Space is what these tests are
 * about, and a setup step that pressed it would be asserting it against itself.
 */
async function pausedOnTheLongest(): Promise<void> {
  await invoke("player_stop");
  await waitForStatus("stopped");
  await playLastRow();
  await browser.$("button[aria-label='Pause']").click();
  await waitForStatus("paused");
}

describe("the keys bound at the window", () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
      timeout: 30_000,
      interval: 500,
    });
    await browser.$("tr.song-row").waitForExist({ timeout: 30_000 });
    await sortByTitle();
  });

  after(async () => {
    // Everything this spec touched, put back: the specs after it share one app
    // process and one library, and each of these outlives the webview.
    await invoke("player_stop");
    await clearSearch();
    // Ctrl+0 rather than the stepper, because a zoom left at 0.9 is not a
    // failing assertion here - it is every screenshot after this one taken at
    // the wrong size.
    await dispatch("body", { key: "0", ctrlKey: true });
    await browser.waitUntil(async () => (await zoomLabel()) === "100%", {
      timeout: 10_000,
      timeoutMsg: "the zoom never went back to 100%",
    });
    await browser.keys(["Escape"]);
    await view("Songs").click();
    await expect(view("Songs")).toHaveAttribute("aria-current", "page");
  });

  describe("space, which is play and pause", () => {
    it("toggles the player, and the button says which it is now", async () => {
      await playLastRow();
      await expect(browser.$(".now-playing-title")).toHaveText(LONGEST);
      await expect(browser.$("button[aria-label='Pause']")).toBeExisting();

      await browser.keys([" "]);

      await waitForStatus("paused");
      // The label is the whole of what a user sees change, so it is asserted
      // rather than the class or the icon.
      await expect(browser.$("button[aria-label='Play']")).toBeExisting();

      await browser.keys([" "]);

      await waitForStatus("playing");
      await expect(browser.$("button[aria-label='Pause']")).toBeExisting();
    });

    it("types a space into the search box instead", async () => {
      await pausedOnTheLongest();

      await focusSearch();
      // TEMPORARY, 123: on the runner this space leaves the field empty while
      // every other key typed into it lands, so the failure has to say where
      // the key went rather than only that it did not arrive.
      await recordKeys();
      await browser.keys([" "]);
      const keydowns = await takeRecordedKeys();

      await browser.waitUntil(async () => (await searchBox().getValue()) === " ", {
        timeout: 5_000,
        timeoutMsg: `the space never reached the field; keydowns: ${keydowns}`,
      });
      // Still paused: the space went into the field rather than to the player.
      expect((await snapshot()).status).toBe("paused");

      await clearSearch();
    });
  });

  describe("the arrows, which are the playhead", () => {
    it("moves the position forward and back", async () => {
      // Paused throughout, so the only thing that can move the playhead is the
      // key: `SilentSink` advances position on a wall clock, and a running
      // player would make "it moved" true whatever the key did.
      await pausedOnTheLongest();
      await row(LIBRARY.length - 1).click();

      const start = (await snapshot()).positionMs;

      await browser.keys(["ArrowRight"]);

      await browser.waitUntil(async () => (await snapshot()).positionMs > start, {
        timeout: 15_000,
        timeoutMsg: `the playhead stayed at ${start}ms`,
      });
      const forward = (await snapshot()).positionMs;

      await browser.keys(["ArrowLeft"]);

      await browser.waitUntil(async () => (await snapshot()).positionMs < forward, {
        timeout: 15_000,
        timeoutMsg: `the playhead stayed at ${forward}ms`,
      });
    });

    it("moves the caret in the search box instead", async () => {
      // Paused for the same reason as above, and asserted rather than assumed:
      // an exact comparison against a wall clock would fail as a mystery.
      expect((await snapshot()).status).toBe("paused");

      await focusSearch();
      await browser.keys(["a", "b"]);
      const before = (await snapshot()).positionMs;

      await browser.keys(["ArrowLeft"]);
      await browser.keys(["ArrowLeft"]);

      expect((await snapshot()).positionMs).toBe(before);
      // And the field kept its text, which is what proves the key was the
      // field's rather than merely lost.
      expect(await searchBox().getValue()).toBe("ab");

      await clearSearch();
    });
  });

  describe("escape, which clears the selection", () => {
    it("clears it", async () => {
      await row(0).click();
      await browser.waitUntil(async () => (await selectedCount()) === 1, {
        timeout: 10_000,
        timeoutMsg: "the row never became selected",
      });

      await browser.keys(["Escape"]);

      await browser.waitUntil(async () => (await selectedCount()) === 0, {
        timeout: 10_000,
        timeoutMsg: "the selection survived Escape",
      });
    });

    it("clears the search box instead, and leaves the selection alone", async () => {
      await row(0).click();
      await browser.waitUntil(async () => (await selectedCount()) === 1, { timeout: 10_000 });
      await focusSearch();
      await browser.keys(["a"]);
      expect(await searchBox().getValue()).toBe("a");

      await browser.keys(["Escape"]);

      // `SearchBox` handles Escape itself and clears, so this is not "nothing
      // happened" - it is the field's own key doing the field's own thing.
      await browser.waitUntil(async () => (await searchBox().getValue()) === "", {
        timeout: 10_000,
        timeoutMsg: "Escape did not clear the search box",
      });
      expect(await selectedCount()).toBe(1);
    });
  });

  describe("ctrl+A, which selects the library", () => {
    it("selects every row", async () => {
      // Clicked out of the search box before Escape is pressed, because the
      // test above leaves the caret in it - and Escape there is the field's
      // own key, which is exactly why it would not clear the selection here.
      await row(0).click();
      await browser.keys(["Escape"]);
      await browser.waitUntil(async () => (await selectedCount()) === 0, {
        timeout: 10_000,
        timeoutMsg: "the selection survived Escape",
      });

      await dispatch("body", { key: "a", ctrlKey: true });

      await browser.waitUntil(async () => (await selectedCount()) === LIBRARY.length, {
        timeout: 15_000,
        timeoutMsg: `Ctrl+A selected ${await selectedCount()} of ${LIBRARY.length} rows`,
      });
    });

    it("selects the text in the search box instead", async () => {
      await focusSearch();
      await browser.keys(["a"]);
      const before = await selectedCount();

      await dispatch(SEARCH, { key: "a", ctrlKey: true });

      expect(await selectedCount()).toBe(before);
      await clearSearch();
    });
  });

  describe("ctrl+I, which is the tag editor", () => {
    it("opens the editor on the selection", async () => {
      await browser.keys(["Escape"]);
      await row(0).click();
      await browser.waitUntil(async () => (await selectedCount()) === 1, { timeout: 10_000 });

      await dispatch("body", { key: "i", ctrlKey: true });

      const dialog = browser.$("[role='dialog']");
      await dialog.waitForExist({ timeout: 15_000, timeoutMsg: "the tag editor never opened" });

      // Cancel, the only exit that writes nothing - `tag-editor.test.ts` owns
      // the save, and this spec has no business rewriting a fixture's tags.
      await browser.$("//button[normalize-space()='Cancel']").click();
      await dialog.waitForExist({ timeout: 10_000, reverse: true });
    });

    it("does nothing from the search box", async () => {
      await focusSearch();
      await browser.keys(["a"]);

      await dispatch(SEARCH, { key: "i", ctrlKey: true });

      expect(await browser.$("[role='dialog']").isExisting()).toBe(false);
      await clearSearch();
    });
  });

  describe("delete, which asks before it removes anything", () => {
    it("opens the confirmation, and takes Cancel for an answer", async () => {
      // As far as the question and no further, for the reason
      // `row-menu.test.ts` gives: the library is shared with every spec after
      // this one, and confirming would take a song out from under them.
      await browser.keys(["Escape"]);
      await row(0).click();
      await browser.waitUntil(async () => (await selectedCount()) === 1, { timeout: 10_000 });

      await browser.keys(["Delete"]);

      const dialog = browser.$("[role='alertdialog']");
      await dialog.waitForExist({ timeout: 15_000, timeoutMsg: "the confirmation never opened" });

      await browser.$("//button[normalize-space()='Cancel']").click();
      await dialog.waitForExist({ timeout: 10_000, reverse: true });
      await expect(row(0)).toBeExisting();
    });

    it("does nothing from the search box", async () => {
      await focusSearch();
      await browser.keys(["a"]);

      await browser.keys(["Delete"]);

      expect(await browser.$("[role='alertdialog']").isExisting()).toBe(false);
      await clearSearch();
    });
  });

  /**
   * The one group whose second test asserts the *opposite* of the rule.
   *
   * `useZoomShortcuts.ts`: "Unlike the transport shortcuts these are *not*
   * suppressed while typing: zoom is chrome, not content, and Ctrl+plus in a
   * text field still means zoom."
   */
  describe("ctrl+plus and ctrl+minus, which are the interface zoom", () => {
    afterEach(async () => {
      // Every test in here, not just the last: a zoom left behind is not a red
      // test, it is a differently-sized app for everything downstream.
      await dispatch("body", { key: "0", ctrlKey: true });
      await browser.waitUntil(async () => (await zoomLabel()) === "100%", {
        timeout: 10_000,
        timeoutMsg: "the zoom never went back to 100%",
      });
    });

    it("steps out and back in, and the footer follows", async () => {
      expect(await zoomLabel()).toBe("100%");

      await dispatch("body", { key: "-", ctrlKey: true });

      await browser.waitUntil(async () => (await zoomLabel()) === "90%", {
        timeout: 10_000,
        timeoutMsg: `Ctrl+minus left the footer reading ${await zoomLabel()}`,
      });

      await dispatch("body", { key: "+", ctrlKey: true });

      await browser.waitUntil(async () => (await zoomLabel()) === "100%", {
        timeout: 10_000,
        timeoutMsg: `Ctrl+plus left the footer reading ${await zoomLabel()}`,
      });
    });

    it("still zooms from inside the search box", async () => {
      await focusSearch();
      await browser.keys(["a"]);

      await dispatch(SEARCH, { key: "-", ctrlKey: true });

      await browser.waitUntil(async () => (await zoomLabel()) === "90%", {
        timeout: 10_000,
        timeoutMsg: "zoom stood down inside the search box, which it must not",
      });

      await clearSearch();
    });

    it("goes back to 100% on ctrl+0", async () => {
      await dispatch("body", { key: "-", ctrlKey: true });
      await browser.waitUntil(async () => (await zoomLabel()) === "90%", { timeout: 10_000 });

      await dispatch("body", { key: "0", ctrlKey: true });

      await browser.waitUntil(async () => (await zoomLabel()) === "100%", {
        timeout: 10_000,
        timeoutMsg: `Ctrl+0 left the footer reading ${await zoomLabel()}`,
      });
    });
  });

  describe("alt+arrow and the mouse's side buttons, which are back and forward", () => {
    beforeEach(async () => {
      await view("Songs").click();
      await expect(view("Songs")).toHaveAttribute("aria-current", "page");
      await view("Releases").click();
      await expect(view("Releases")).toHaveAttribute("aria-current", "page");
    });

    it("goes back on alt+left and forward on alt+right", async () => {
      await dispatch("body", { key: "ArrowLeft", altKey: true });

      await expect(view("Songs")).toHaveAttribute("aria-current", "page");

      await dispatch("body", { key: "ArrowRight", altKey: true });

      await expect(view("Releases")).toHaveAttribute("aria-current", "page");
    });

    it("leaves alt+left to the search box", async () => {
      await focusSearch();
      await browser.keys(["a"]);

      await dispatch(SEARCH, { key: "ArrowLeft", altKey: true });

      await expect(view("Releases")).toHaveAttribute("aria-current", "page");
      await clearSearch();
    });

    it("goes back on button 3 and forward on button 4", async () => {
      await pressSideButton("body", 3);

      await expect(view("Songs")).toHaveAttribute("aria-current", "page");

      await pressSideButton("body", 4);

      await expect(view("Releases")).toHaveAttribute("aria-current", "page");
    });

    it("still navigates on a side button pressed over the search box", async () => {
      // The second exception to the rule, and `useHistoryShortcuts.ts` says
      // why: a thumb on a mouse button is unambiguous where a hand on the
      // keyboard is not, so the side buttons work from inside a text field
      // where Alt+← does not.
      await focusSearch();
      await browser.keys(["a"]);

      await pressSideButton(SEARCH, 3);

      await expect(view("Songs")).toHaveAttribute("aria-current", "page");
      await clearSearch();
    });
  });
});
