import { browser, expect } from "@wdio/globals";
import { capture } from "../screenshot";
import { clearGround, GROUNDS, setGround } from "../theme";

/**
 * The two grounds, photographed over a library with something in it.
 *
 * Nothing here is an assertion about colour - `appearance.test.ts` measures
 * both grounds against the composited stack, and `App.css.test.ts` asserts the
 * token pairs. This exists because phase 108 is the one change in this project
 * that a reviewer cannot review from a diff: a pull request that adds a whole
 * theme otherwise describes it in prose and asks them to imagine it.
 *
 * It runs after `library` because an empty table is not a photograph of this
 * app. It changes nothing but an attribute and puts it back, so the specs after
 * it see the library exactly as they would have.
 */
describe("both grounds, for the reviewer", () => {
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
    it(`photographs the ${ground} ground`, async () => {
      await setGround(ground);

      // The attribute is what the stylesheet keys off, so a shot taken before
      // it landed would be a photograph of the other theme - and the two are
      // only told apart by eye, which is the one check this file cannot do.
      await browser.waitUntil(
        async () =>
          (await browser.execute(() => document.documentElement.getAttribute("data-theme"))) ===
          ground,
        { timeout: 5000, timeoutMsg: `the ${ground} ground never applied` },
      );

      expect(await capture(`ground-${ground}`)).toBe(true);
    });
  }
});
