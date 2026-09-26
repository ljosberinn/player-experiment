import { browser, expect } from "@wdio/globals";
import { invoke } from "../invoke";
import { closeMenu, itemsOf, openMenu } from "../menu";

/** Snapshot of what the webview actually holds, for failure messages. */
async function describeWebview(): Promise<string> {
  const safe = async <T>(label: string, read: () => Promise<T>): Promise<string> => {
    try {
      return `${label}=${JSON.stringify(await read())}`;
    } catch (cause) {
      return `${label}=<threw ${String(cause)}>`;
    }
  };

  const parts = await Promise.all([
    safe("url", () => browser.getUrl()),
    safe("title", () => browser.getTitle()),
    safe("readyState", () => browser.execute(() => document.readyState)),
    safe("rootChildren", () =>
      browser.execute(() => document.getElementById("root")?.childElementCount ?? -1),
    ),
    safe("hasTauriInternals", () => browser.execute(() => "__TAURI_INTERNALS__" in window)),
    safe("bodyHead", () =>
      browser.execute(() => document.body?.innerHTML.slice(0, 400) ?? "<no body>"),
    ),
  ]);

  return `webview never loaded the app document: ${parts.join(" ")}`;
}

describe("application shell", () => {
  it("boots and renders the library chrome", async () => {
    // The driver can attach while the webview is still on about:blank, so wait
    // for the app document itself rather than trusting the first query.
    try {
      await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
        timeout: 30_000,
        interval: 500,
      });
    } catch {
      // Built after the wait, not before, so it reports the state at failure.
      // Distinguishes "never navigated" from "navigated but the bundle threw"
      // and from "attached to the wrong webview" without another CI round.
      throw new Error(await describeWebview());
    }

    // The sidebar is static chrome, and since phase 35 it is also what chooses
    // the view - the tab bar above the table is gone.
    await expect(browser.$("nav[aria-label='Library']")).toBeExisting();
    await expect(browser.$(".sidebar-item[aria-current='page']")).toHaveText("Songs");
    await expect(browser.$("input[aria-label='Search Library']")).toBeExisting();
  });

  it("reaches the database, which is what the empty state proves", async () => {
    // This text only renders after count_tracks resolves, so it asserts the
    // whole round trip: SQLite opened, migrations ran, IPC replied. A failure
    // in any of those would leave the app on its loading state instead.
    // An empty library draws the empty state and no summary; one with songs
    // draws the summary. Either is an answer from the database.
    const answered = async (selector: string, text: RegExp) => {
      const element = browser.$(selector);
      return (await element.isExisting()) && text.test(await element.getText());
    };
    await browser.waitUntil(
      async () =>
        (await answered(".empty-state", /^No songs yet/)) ||
        (await answered(".view-summary", /songs?(,|$)/)),
      { timeout: 30_000, timeoutMsg: "neither the empty state nor a summary arrived" },
    );
  });

  it("switches to a browse view, which was dead chrome until phase 19", async () => {
    // Releases/Artists/Genres rendered `disabled` from phase 3 onward. An
    // empty library has no releases, so this proves the entry is live and
    // the view behind it renders - not what it renders.
    //
    // Sidebar entries since phase 35, so `.` rather than `text()`: the label
    // is a span inside the button, and `text()` only sees direct text nodes.
    await browser.$("//button[.='Releases']").click();
    await expect(browser.$(".sidebar-item[aria-current='page']")).toHaveText("Releases");
    await expect(browser.$(".empty-state")).toBeExisting();

    // `.empty-state` centres through `margin: auto`, which only works as a
    // flex child of `.content`; wrapped in a block it sat at the top left.
    // The text rather than the element, which as a block spans the pane anyway.
    const offset = await browser.execute(() => {
      const pane = document.querySelector(".content");
      const empty = document.querySelector(".empty-state");
      if (pane === null || empty === null) {
        return Number.POSITIVE_INFINITY;
      }
      const text = document.createRange();
      text.selectNodeContents(empty);
      const line = text.getBoundingClientRect();
      const box = pane.getBoundingClientRect();
      return line.left + line.width / 2 - (box.left + box.width / 2);
    });
    expect(Math.abs(offset)).toBeLessThan(2);

    await browser.$("//button[.='Songs']").click();
    await expect(browser.$(".sidebar-item[aria-current='page']")).toHaveText("Songs");
  });

  it("offers the controls that drive a scan", async () => {
    // In the File menu since phase 34, where every action that used to sit on
    // the toolbar now lives.
    await openMenu("File");
    expect(await itemsOf("File")).toEqual(["Add Folders…", "Rescan"]);
    await closeMenu();
  });

  it("draws no player bar while nothing is loaded", async () => {
    // With an empty library there is nothing to play, so the bar is not drawn
    // at all; `player-bar.test.ts` drives it once there is.
    await expect(browser.$(".player-bar")).not.toBeExisting();
  });

  it("survives a play command with an empty queue", async () => {
    // A round trip through player_toggle, which is what Space and the media
    // keys send: if the command were missing or the player thread had died,
    // invoke would reject. CI runners have no audio device, so the app falls
    // back to a null sink - deliberately, since refusing to start there would
    // be worse.
    await invoke("player_toggle");

    await browser.pause(500);
    // Nothing to resume, so nothing loads and nothing is reported.
    expect((await invoke<{ status: string }>("player_snapshot")).status).toBe("stopped");
    await expect(browser.$("[role='alertdialog']")).not.toBeExisting();
    await expect(browser.$(".player-bar")).not.toBeExisting();
  });

  it("runs a search against FTS5 and clears it again", async () => {
    const box = browser.$("input[aria-label='Search Library']");
    await box.setValue("zzzznomatch");

    // The empty-state text only appears once count_tracks has come back with
    // zero, so it proves the search reached SQLite rather than being swallowed
    // by the debounce.
    await expect(browser.$(".empty-state")).toHaveText(/No results for/);

    await browser.$("button[aria-label='Clear search']").click();
    await expect(browser.$(".empty-state")).toHaveText(/No songs yet/);
  });
});
