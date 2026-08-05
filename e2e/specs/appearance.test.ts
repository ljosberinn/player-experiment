import { browser, expect } from "@wdio/globals";
import { contrast, flatten, luminance } from "../contrast";

/**
 * The layer nothing else can see.
 *
 * Three defects reached a user in a running build during phases 16-18, and all
 * three were appearance:
 *
 * - the playing marker was `--accent` on a row filled with `--accent`, so it
 *   vanished until the selection moved off it;
 * - a dialog rendered below the footer, because it had relied on a flex parent
 *   that Base UI no longer gave it;
 * - form fields drew their border in `--chrome-border`, which was #1a1a1c on a
 *   #191a1c field - a contrast ratio of 1.02:1.
 *
 * Every one passed six hundred green unit tests, because **jsdom applies no
 * stylesheet**: it has no layout engine and no computed colour, so `App.css`
 * might as well not exist there. `App.css.test.ts` reads the stylesheet as text,
 * which catches what it is told to catch, one regression at a time, after the
 * fact.
 *
 * This suite asks the real engine instead. It runs against the built app in the
 * real WebView2, where `getComputedStyle` and `getBoundingClientRect` return
 * the truth.
 *
 * # Why not screenshots
 *
 * Pixel baselines were the obvious answer and are the wrong one here. They
 * would have to be generated on the runner, because font rendering differs
 * between this machine and Windows Server; they flake on antialiasing; they
 * need storage for baselines and diffs; and a failure says "17,000 pixels
 * differ" rather than what is wrong. None of the three defects above was a
 * pixel shift - each was a computed value that could simply have been asked
 * for. So this asserts computed values, which are deterministic, need no
 * baseline, and name the fault when they fail.
 */

/**
 * Opens the smart-playlist filter editor.
 *
 * The filter editor rather than the tag editor because it is the dialog an
 * *empty* library can reach - Get Info needs a selection, and the smoke suite
 * runs against a library with nothing in it. It is also the denser of the two:
 * a row of selects and inputs, which is where the contrast defect showed worst.
 */
async function openFilterDialog(): Promise<void> {
  await browser.$("button[aria-label='New smart playlist']").click();
  await browser.$("[role='dialog']").waitForExist({ timeout: 10_000 });
}

async function closeDialog(): Promise<void> {
  const cancel = browser.$("//button[text()='Cancel']");
  if (await cancel.isExisting()) {
    await cancel.click();
    await browser.$("[role='dialog']").waitForExist({ timeout: 10_000, reverse: true });
  }
}

/** The computed value of one property, for the first element matching. */
function computed(selector: string, property: string): Promise<string> {
  return browser.execute(
    (sel: string, prop: string) => {
      const element = document.querySelector(sel);
      return element === null ? "" : getComputedStyle(element).getPropertyValue(prop);
    },
    selector,
    property,
  );
}

describe("appearance, in the engine that actually lays it out", () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
      timeout: 30_000,
      interval: 500,
    });
  });

  afterEach(async () => {
    // Both, always: a test that failed mid-dialog would otherwise leave it open
    // and take the next one down with it.
    //
    // Swallowed, because cleanup is not the assertion. When the session has
    // already gone these throw "A sessionId is required for this command",
    // which lands in the log next to the real failure and reads like a second
    // fault. Nothing here can fail in a way worth reporting.
    try {
      await closeDialog();
    } catch {
      // The session is gone; the test that mattered has already reported.
    }
  });

  /* One theme, since phase 33: the light and `prefers-color-scheme` blocks are
     gone and the app is dark only. What made this suite loop - a runner that
     boots light while two of the three defects were dark-only - is no longer a
     risk, because there is only one set of values and it is the set that runs.
     The colours still have to be measured; there is just one pass of it. */
  describe("in the one theme there is", () => {
    it("draws form fields with an edge you can see", async () => {
      // The defect: `--chrome-border` is tuned to separate two panels of
      // chrome. On a field's own surface it had a contrast ratio of 1.02:1 in
      // dark mode - the input was invisible, and a select was recognisable
      // only by its arrow.
      await openFilterDialog();

      const fields = await browser.execute(() => {
        const dialogElement = document.querySelector("[role='dialog']");
        if (dialogElement === null) {
          return [];
        }
        return Array.from(dialogElement.querySelectorAll("input, select")).map((field) => {
          const style = getComputedStyle(field);
          const parent = field.parentElement;
          return {
            tag: field.tagName.toLowerCase(),
            border: style.borderTopColor,
            background: style.backgroundColor,
            behind: parent === null ? "" : getComputedStyle(parent).backgroundColor,
          };
        });
      });

      expect(fields.length).toBeGreaterThan(0);

      // Collected rather than asserted one at a time: `expect` here takes no
      // message, so the list *is* the failure message - and it reports every
      // bad field at once instead of the first.
      const tooFaint = fields
        .map((field) => ({ ...field, ratio: contrast(field.border, field.background) }))
        .filter((field) => field.ratio <= 2)
        .map(
          (field) =>
            `${field.tag}: border ${field.border} on ${field.background} = ${field.ratio.toFixed(2)}:1`,
        );

      expect(tooFaint).toEqual([]);
    });

    it("puts a dialog over the app rather than after it", async () => {
      // The defect: `.modal` relied on its backdrop for centring, Base UI
      // renders the two as siblings, and the dialog landed below the footer -
      // off the bottom of a window that does not scroll.
      await openFilterDialog();

      const geometry = await browser.execute(() => {
        const dialogElement = document.querySelector("[role='dialog']");
        if (dialogElement === null) {
          return null;
        }
        const box = dialogElement.getBoundingClientRect();
        const centre = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return {
          box: { top: box.top, left: box.left, right: box.right, bottom: box.bottom },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          // What is actually on top at the dialog's own centre. If something
          // else answers, the dialog is behind it whatever its rect says.
          centreIsInsideDialog: centre !== null && dialogElement.contains(centre),
        };
      });

      expect(geometry).not.toBe(null);
      const { box, viewport, centreIsInsideDialog } = geometry as NonNullable<typeof geometry>;

      const problems: string[] = [];
      if (box.top < 0) {
        problems.push(`starts ${-box.top}px above the viewport`);
      }
      if (box.left < 0) {
        problems.push(`starts ${-box.left}px left of the viewport`);
      }
      if (box.bottom > viewport.height + 1) {
        problems.push(`runs ${box.bottom - viewport.height}px off the bottom`);
      }
      if (box.right > viewport.width + 1) {
        problems.push(`runs ${box.right - viewport.width}px off the right`);
      }
      if (!centreIsInsideDialog) {
        problems.push("something else is on top at the dialog's own centre");
      }

      expect(problems).toEqual([]);
    });

    it("makes a control's shape visible against what it sits on", async () => {
      // Reported by the user after the first version of this suite passed:
      // the volume slider's rail was `--skeleton`, the loading-placeholder
      // colour tuned for `--surface`, but the slider sits on `--chrome` in
      // the toolbar. That was #e3e6ea on #e8e8e8 - 1.02:1, the same
      // magnitude as the invisible field border, and this suite missed it
      // because it only looked at text and at field borders.
      //
      // WCAG 1.4.11 asks 3:1 of the parts of a control needed to understand
      // it, and a slider you cannot see the extent of is exactly that.
      const parts = await browser.execute(
        (selectors: string[]) =>
          selectors.flatMap((selector) => {
            const element = document.querySelector(selector);
            if (element === null) {
              return [];
            }
            const style = getComputedStyle(element);
            // Every fill from here up to the root, front to back. A single
            // layer is not enough since phase 33: a highlight is an 18% wash,
            // and reading it alone reports it as solid.
            let painter = element.parentElement;
            const stack: string[] = [];
            while (painter !== null) {
              const fill = getComputedStyle(painter).backgroundColor;
              if (fill !== "" && fill !== "rgba(0, 0, 0, 0)" && fill !== "transparent") {
                stack.push(fill);
              }
              painter = painter.parentElement;
            }
            const behind = stack.length === 0 ? "" : JSON.stringify(stack);
            // Either edge may carry it: a control can be legible through its
            // own fill, or through an outline drawn around a fill that is not.
            return [
              {
                selector,
                behind,
                fill: style.backgroundColor,
                border: style.borderTopWidth === "0px" ? "" : style.borderTopColor,
              },
            ];
          }),
        [".volume-rail", ".status-track-rail", ".volume-thumb"],
      );

      const invisible = parts
        .filter((part) => part.behind !== "")
        .map((part) => ({
          ...part,
          best: Math.max(
            part.fill === "" ? 0 : contrast(part.fill, flatten(JSON.parse(part.behind))),
            part.border === "" ? 0 : contrast(part.border, flatten(JSON.parse(part.behind))),
          ),
        }))
        .filter((part) => part.best < 3)
        .map(
          (part) =>
            `${part.selector}: fill ${part.fill || "none"} / border ${part.border || "none"} on ${part.behind} = ${part.best.toFixed(2)}:1`,
        );

      expect(invisible).toEqual([]);
    });

    it("keeps the chrome legible against what it sits on", async () => {
      // Not one defect but the class of them: a colour pair that works in one
      // theme and collapses in the other, which is how two of the three got
      // through.
      // Only the foreground is named. The background is *resolved* by walking
      // up to the first ancestor that actually paints one, because naming it
      // by hand is how the first version of this test produced a false
      // positive: it measured the selected tab's white text against
      // `.content-header` and reported 1.23:1, when the tab paints its own
      // accent fill and the real ratio is fine.
      const measured = await browser.execute(
        (selectors: string[]) =>
          selectors.map((selector) => {
            const element = document.querySelector(selector);
            if (element === null) {
              return { selector, text: "", behind: "", from: "" };
            }
            // Starts at the element itself and keeps going to the root: a
            // selected row is an 18% accent wash over the table, so the fill it
            // paints is not the colour its text actually sits on.
            let painter: Element | null = element;
            let from: Element | null = null;
            const stack: string[] = [];
            while (painter !== null) {
              const fill = getComputedStyle(painter).backgroundColor;
              if (fill !== "" && fill !== "rgba(0, 0, 0, 0)" && fill !== "transparent") {
                stack.push(fill);
                from ??= painter;
              }
              painter = painter.parentElement;
            }
            return {
              selector,
              text: getComputedStyle(element).color,
              behind: stack.length === 0 ? "" : JSON.stringify(stack),
              from: from === null ? "" : from.className.toString() || from.tagName,
            };
          }),
        [
          ".statusbar-summary",
          ".status-summary",
          "[role='tab'][aria-selected='true']",
          ".sidebar-item",
          ".empty-state",
        ],
      );

      const illegible = measured
        .filter((one) => one.text !== "" && one.behind !== "")
        .map((one) => ({ ...one, ratio: contrast(one.text, flatten(JSON.parse(one.behind))) }))
        // 4.5:1 is the WCAG AA threshold for body text.
        .filter((one) => one.ratio <= 4.5)
        .map(
          (one) =>
            `${one.selector} (${one.text}) on ${one.from} (${one.behind}) = ${one.ratio.toFixed(2)}:1`,
        );

      expect(illegible).toEqual([]);
    });
  });

  it("keeps the whole title bar on one row, inside the window", async () => {
    // The defect this exists for, found by looking at a screenshot rather than
    // by any assertion: the title bar was a four-column grid holding four
    // things, and phase 34 gave it seven. Grid auto-placement only moves
    // forward, so the overflow started a second row - the window buttons ended
    // up below the bar and the now-playing display was clipped off the right
    // edge of the window. Every unit test passed.
    const layout = await browser.execute(() => {
      const bar = document.querySelector(".titlebar");
      if (bar === null) {
        return null;
      }
      const children = Array.from(bar.children).map((child) => {
        const box = child.getBoundingClientRect();
        return {
          what: child.className.toString() || child.tagName,
          top: Math.round(box.top),
          right: Math.round(box.right),
        };
      });
      return { children, width: window.innerWidth };
    });

    expect(layout).not.toBe(null);
    const { children, width } = layout as NonNullable<typeof layout>;
    expect(children.length).toBeGreaterThan(3);

    // One row: every child starts within a few pixels of the topmost one.
    // Not exactly equal - they are vertically centred at different heights.
    //
    // The caption cluster is left out of this comparison, not out of the test.
    // It deliberately hangs off the top edge (see `.window-buttons`, which
    // pulls itself flush with the top so the corner stays hittable), so it is
    // always the topmost thing on the bar by about thirty pixels - which made
    // every *correctly* centred child look like it had wrapped below it. It
    // still has to stay inside the window, which the right-edge check below
    // covers.
    const inFlow = children.filter((child) => !child.what.includes("window-buttons"));
    const highest = Math.min(...inFlow.map((child) => child.top));
    const wrapped = inFlow
      .filter((child) => child.top > highest + 20)
      .map((child) => `${child.what} sits ${child.top - highest}px below the bar`);

    // And nothing runs off the right edge, which is the other half of the same
    // fault: a row that cannot wrap overflows instead.
    const clipped = children
      .filter((child) => child.right > width + 1)
      .map((child) => `${child.what} runs ${child.right - width}px past the window`);

    expect([...wrapped, ...clipped]).toEqual([]);
  });

  it("draws the accent strip along the top of the window", async () => {
    // Decoration, and the design's most recognisable single element. Drawn as
    // a pseudo-element, so it has no node to query - the height of the strip
    // is the gap between the top of the window and the top of the title bar.
    const offset = await browser.execute(() => {
      const bar = document.querySelector(".titlebar");
      return bar === null ? -1 : Math.round(bar.getBoundingClientRect().top);
    });

    expect(offset).toBeGreaterThan(0);
  });

  it("draws the dark palette rather than a default white page", async () => {
    // Guards the tests above. They resolve the background by walking up to the
    // first ancestor that paints one, so a stylesheet that failed to load
    // entirely would leave them measuring black text on white and passing.
    const background = await computed("body", "background-color");

    expect(background).not.toBe("");
    // Measured rather than pattern-matched on the string: the engine returns
    // whichever notation the sheet was authored in, and this has to keep
    // meaning the same thing if that ever changes again. Every surface in the
    // ramp sits below oklch(0.3), nowhere near the 0.18 relative luminance of
    // a mid grey.
    expect(luminance(background)).toBeLessThan(0.05);
  });

  it("renders numerals in the face the design asks for", async () => {
    // Vendored through @fontsource and imported in main.tsx. A missing woff2
    // falls back silently to the UI font, which looks fine and is wrong - the
    // whole point of the token is that figures are set in Space Grotesk.
    const family = await computed(".statusbar-zoom-value", "font-family");

    expect(family).toContain("Space Grotesk");
  });
});
