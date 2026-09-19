import { browser, expect } from "@wdio/globals";
import { chooseFromMenu } from "../menu";
import { capture } from "../screenshot";

/**
 * The history import row in the last.fm section of Settings.
 *
 * A screenshot because it is the first text field in that section:
 * `LastfmSettings.test.tsx` proves what the controls do, but not whether a
 * label, a field and a button fit the row beside the prose around them.
 *
 * The e2e build carries no last.fm key, so Import is disabled and nothing is
 * ever sent - which is also the state every CI run and local build is in.
 */
describe("the last.fm history import", () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
      timeout: 30_000,
      interval: 500,
    });
  });

  it("offers the import beside the connection", async () => {
    await chooseFromMenu("Edit", "Settings…");
    await browser.$("//*[@role='tab'][normalize-space()='Online']").click();
    const section = browser.$(".settings-lastfm");
    await section.waitForExist({ timeout: 10_000 });
    await section.scrollIntoView();

    await expect(browser.$("#lastfm-import-user")).toBeExisting();
    await expect(browser.$("//button[text()='Import']")).toBeDisabled();

    await capture("settings-lastfm-import");
    await browser.$("//button[text()='Done']").click();
    await browser.$("[role='dialog']").waitForExist({ timeout: 10_000, reverse: true });
  });
});
