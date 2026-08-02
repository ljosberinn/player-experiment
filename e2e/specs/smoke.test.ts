import { browser, expect } from "@wdio/globals";

describe("application shell", () => {
  it("boots and renders the library chrome", async () => {
    // The driver can attach while the webview is still on about:blank, so wait
    // for the app document itself rather than trusting the first query.
    await browser.waitUntil(async () => (await browser.getTitle()) === "Player", {
      timeout: 30_000,
      interval: 500,
      timeoutMsg: `webview never loaded the app document (url: ${await browser.getUrl()})`,
    });

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
