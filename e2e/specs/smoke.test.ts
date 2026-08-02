import { browser, expect } from "@wdio/globals";

describe("application shell", () => {
  it("boots and answers the get_app_info command", async () => {
    // The driver can attach while the webview is still on about:blank, so wait
    // for the app document itself rather than trusting the first query.
    await browser.waitUntil(
      async () => {
        const title = await browser.getTitle();
        return title === "Player";
      },
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg: `webview never loaded the app document (url: ${await browser.getUrl()})`,
      },
    );

    const heading = await browser.$("h1");
    await expect(heading).toHaveText("Player");

    // The version line only renders once the Rust side has replied, so this
    // asserts the IPC round trip, not just that a window opened.
    const status = await browser.$("main p");
    await expect(status).toHaveText(/^player \d+\.\d+\.\d+$/);
  });
});
