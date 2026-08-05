import { browser, expect } from "@wdio/globals";
import { contrast } from "../contrast";

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
 * - form fields drew their border in `--chrome-border`, which in dark mode is
 *   #1a1a1c on a #191a1c field - a contrast ratio of 1.02:1.
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
 * Forces a theme for the rest of the spec.
 *
 * A CI runner boots light, and two of the three defects above were dark-only.
 * `App.css` carries a `[data-theme="dark"]` block holding the same values as
 * its `prefers-color-scheme` block - kept identical by a guard in
 * `App.css.test.ts` - precisely so one run can check both.
 */
async function applyTheme(theme: "light" | "dark"): Promise<void> {
  await browser.execute((value: string) => {
    if (value === "light") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = value;
    }
  }, theme);
}

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
      await applyTheme("light");
    } catch {
      // The session is gone; the test that mattered has already reported.
    }
  });

  for (const theme of ["light", "dark"] as const) {
    describe(`in the ${theme} theme`, () => {
      beforeEach(async () => {
        await applyTheme(theme);
      });

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
              let painter = element.parentElement;
              let behind = "";
              while (painter !== null) {
                const fill = getComputedStyle(painter).backgroundColor;
                if (fill !== "" && fill !== "rgba(0, 0, 0, 0)" && fill !== "transparent") {
                  behind = fill;
                  break;
                }
                painter = painter.parentElement;
              }
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
              part.fill === "" ? 0 : contrast(part.fill, part.behind),
              part.border === "" ? 0 : contrast(part.border, part.behind),
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
              let painter: Element | null = element;
              let behind = "";
              while (painter !== null) {
                const fill = getComputedStyle(painter).backgroundColor;
                if (fill !== "" && fill !== "rgba(0, 0, 0, 0)" && fill !== "transparent") {
                  behind = fill;
                  break;
                }
                painter = painter.parentElement;
              }
              return {
                selector,
                text: getComputedStyle(element).color,
                behind,
                from: painter === null ? "" : painter.className.toString() || painter.tagName,
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
          .map((one) => ({ ...one, ratio: contrast(one.text, one.behind) }))
          // 4.5:1 is the WCAG AA threshold for body text.
          .filter((one) => one.ratio <= 4.5)
          .map(
            (one) =>
              `${one.selector} (${one.text}) on ${one.from} (${one.behind}) = ${one.ratio.toFixed(2)}:1`,
          );

        expect(illegible).toEqual([]);
      });
    });
  }

  it("has a dark theme that is actually different", async () => {
    // Guards the two tests above: if `data-theme` stopped being honoured, both
    // would quietly run twice against the light theme and still pass.
    await applyTheme("light");
    const light = await computed("body", "background-color");
    await applyTheme("dark");
    const dark = await computed("body", "background-color");
    await applyTheme("light");

    expect(light).not.toBe("");
    expect(dark).not.toBe(light);
  });
});
