import { browser, expect } from "@wdio/globals";
import { chooseFromMenu } from "../menu";
import { capture } from "../screenshot";
import { clearGround, GROUNDS, setGround } from "../theme";

/**
 * The control set phase 111 drew, photographed on both grounds.
 *
 * `controls.test.tsx` proves what each primitive does and `App.css.test.ts`
 * measures every mark it draws, but neither can say whether a checkbox, a
 * select and a pair of them in a row look like one widget language. That is
 * the whole claim of the issue - "a half-replaced control set is two widget
 * languages in one dialog" - and it is the one claim only a picture settles.
 *
 * Same argument as `theme.test.ts`: a pull request that replaces every widget
 * in the app otherwise describes them in prose and asks a reviewer to imagine
 * them.
 *
 * Before the library is seeded, because none of these controls need a song:
 * the filter editor opens over an empty table and Settings does not look at
 * one. It saves nothing and puts the ground back, so the specs after it see
 * the app exactly as they would have.
 */

async function openFilterDialog(): Promise<void> {
  await browser.$("button[aria-label='New smart playlist']").click();
  await browser.$("[role='dialog']").waitForExist({ timeout: 10_000 });
}

async function closeDialog(label: string): Promise<void> {
  await browser.$(`//button[text()='${label}']`).click();
  await browser.$("[role='dialog']").waitForExist({ timeout: 10_000, reverse: true });
}

/**
 * Builds a dialog with one of everything in it.
 *
 * A rule and a nested group put four selects on screen at two depths; ticking
 * the cutoff is what takes the sort row out of its disabled state, so the shot
 * carries an enabled checkbox, a disabled one and two live selects rather than
 * a row of greyed-out furniture.
 */
async function fill(): Promise<void> {
  await browser.$("//button[text()='+ Rule']").click();
  await browser.$("//button[text()='+ Group']").click();

  // The visible caption rather than the drawn box: the box is a `<span>` and
  // the input behind it is transparent, but a `<label for>` activates its
  // control whatever the control is drawn as.
  await browser.$("//label[normalize-space()='Limited to']").click();
  await browser.$(".filter-order input[type='number']").waitForEnabled({ timeout: 5000 });
}

describe("the drawn controls, for the reviewer", () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
      timeout: 30_000,
      interval: 500,
    });
  });

  after(async () => {
    await clearGround();
  });

  for (const ground of GROUNDS) {
    it(`photographs the control set on the ${ground} ground`, async () => {
      await setGround(ground);

      // The attribute is what the stylesheet keys off, so a shot taken before
      // it landed would be a photograph of the other ground.
      await browser.waitUntil(
        async () =>
          (await browser.execute(() => document.documentElement.getAttribute("data-theme"))) ===
          ground,
        { timeout: 5000, timeoutMsg: `the ${ground} ground never applied` },
      );

      await openFilterDialog();
      await fill();

      // Guards the guard: a dialog that failed to grow its rule would still
      // photograph, and a picture of an empty editor proves nothing about the
      // controls this spec exists for.
      await expect(browser.$$(".select")).toBeElementsArrayOfSize({ gte: 4 });
      await expect(browser.$$(".checkbox-box")).toBeElementsArrayOfSize({ gte: 2 });

      expect(await capture(`drawn-controls-filter-${ground}`)).toBe(true);
      await closeDialog("Cancel");

      // Settings, for the two the filter editor has no place for: a select
      // named by a label outside it, and a checkbox sat at the right of a row.
      await chooseFromMenu("Edit", "Settings…");
      await browser.$("#theme").waitForExist({ timeout: 10_000 });

      expect(await capture(`drawn-controls-settings-${ground}`)).toBe(true);
      await closeDialog("Done");
    });
  }
});
