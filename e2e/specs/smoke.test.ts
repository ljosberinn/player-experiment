import { browser, expect } from "@wdio/globals";

describe("application shell", () => {
  it("boots and answers the get_app_info command", async () => {
    const heading = await browser.$("h1");
    await expect(heading).toHaveText("Player");

    // The version line only renders once the Rust side has replied, so this
    // asserts the IPC round trip, not just that a window opened.
    const status = await browser.$("main p");
    await expect(status).toHaveText(/^player \d+\.\d+\.\d+$/);
  });
});
