import { browser, expect } from "@wdio/globals";

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
      await browser.waitUntil(async () => (await browser.getTitle()) === "Player", {
        timeout: 30_000,
        interval: 500,
      });
    } catch {
      // Built after the wait, not before, so it reports the state at failure.
      // Distinguishes "never navigated" from "navigated but the bundle threw"
      // and from "attached to the wrong webview" without another CI round.
      throw new Error(await describeWebview());
    }

    // The sidebar and tab bar are static chrome.
    await expect(browser.$("nav[aria-label='Library']")).toBeExisting();
    await expect(browser.$("//button[text()='Music']")).toBeExisting();
    await expect(browser.$("[role='tab'][aria-selected='true']")).toHaveText("Songs");
    await expect(browser.$("input[aria-label='Search Library']")).toBeExisting();
  });

  it("reaches the database, which is what the empty state proves", async () => {
    // This text only renders after count_tracks resolves, so it asserts the
    // whole round trip: SQLite opened, migrations ran, IPC replied. A failure
    // in any of those would leave the app on its loading state instead.
    const status = await browser.$(".statusbar");
    await expect(status).toHaveText(/songs?$|^No songs$/);
  });

  it("offers the controls that drive a scan", async () => {
    await expect(browser.$("//button[text()='Add Folder…']")).toBeExisting();
    await expect(browser.$("//button[text()='Rescan']")).toBeExisting();
  });
});
