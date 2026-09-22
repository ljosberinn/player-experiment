import { browser, expect } from "@wdio/globals";
import { contrast, flatten, luminance } from "../contrast";
import { chooseFromMenu } from "../menu";
import { clearGround, GROUNDS, type Ground, setGround } from "../theme";

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
 * *empty* library can reach - Edit needs a selection, and the smoke suite
 * runs against a library with nothing in it. It is also the denser of the two:
 * a row of selects and inputs, which is where the contrast defect showed worst.
 */
async function openFilterDialog(): Promise<void> {
  await browser.$("button[aria-label='New smart playlist']").click();
  await browser.$("[role='dialog']").waitForExist({ timeout: 10_000 });
}

/**
 * Shuts whatever dialog is open, whichever way out it offers.
 *
 * Both buttons, because the two dialogs this spec opens do not agree: the
 * filter editor says Cancel and Settings says Done. While this only knew about
 * Cancel, one failing test inside Settings left its dialog standing, and every
 * later test that opened another one measured the wrong one - four failures
 * reported against three tests that were not broken. A cleanup that only works
 * for some of the dialogs is how one red test becomes five.
 */
async function closeDialog(): Promise<void> {
  for (const label of ["Cancel", "Done"]) {
    const button = browser.$(`//button[text()='${label}']`);
    if (await button.isExisting()) {
      await button.click();
      await browser.$("[role='dialog']").waitForExist({ timeout: 10_000, reverse: true });
      return;
    }
  }
}

/**
 * Opens Settings on Appearance, where the theme control lives.
 *
 * Its own pair rather than `closeDialog` above: that one clicks Cancel, and
 * the Settings dialog's button says Done. Reusing it here would leave the
 * dialog open and take the next spec down with it.
 */
async function openSettings(): Promise<void> {
  await chooseFromMenu("Edit", "Settings…");
  await browser.$("#theme").waitForExist({ timeout: 10_000 });
}

async function closeSettings(): Promise<void> {
  await browser.$("//button[text()='Done']").click();
  await browser.$("[role='dialog']").waitForExist({ timeout: 10_000, reverse: true });
}

/**
 * Picks a theme in Settings, by clicking it the way a user would.
 *
 * This used to reach past the driver and set the value through
 * `HTMLSelectElement.prototype`'s own setter. The reason was WebView2: a closed
 * native `<select>` draws its list as an OS popup rather than as DOM boxes, so
 * `selectByAttribute`'s click landed on nothing and the value never moved - it
 * shipped green locally and timed out in CI.
 *
 * Phase 111 drew the select itself, and the list is DOM again. The whole chain
 * is now clickable, which is both simpler and a stronger test: the previous
 * version could not have caught a trigger that never opened.
 */
async function chooseTheme(label: string): Promise<void> {
  await browser.$("#theme").click();
  await browser.$(`[role='option']=${label}`).click();

  // The popup is animated out rather than removed, so the next click has to
  // wait for it to stop covering the dialog.
  await browser.$("[role='listbox']").waitForDisplayed({ timeout: 5000, reverse: true });
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

  /* Both grounds, since phase 108, and the loop is back for the reason it was
     removed: there are two sets of values again, and only one of them is the
     one whoever wrote a token was looking at. The ramps run in opposite
     directions, so a tone that is safely recessive on dark can be the
     brightest thing in the room on light, and every ratio in this block is
     computed from what the engine actually composited rather than from what
     the sheet says.

     `App.css.test.ts` asserts the same pairs against the token values. This
     asserts them against the *stack* - veils, washes and the blob layer
     included - which is the half that arithmetic on a token cannot reach. */
  for (const ground of GROUNDS) {
    describe(`on the ${ground} ground`, () => {
      before(async () => {
        await setGround(ground);
      });

      after(async () => {
        // Back to what the app decided for itself, so a spec outside this loop
        // is not silently measuring whichever ground ran last.
        await clearGround();
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
          // `.select` rather than `select`, as of phase 111. The drawn controls
          // keep a real input behind the drawing - transparent for a checkbox,
          // clipped to a pixel for a select's form value - and measuring the
          // edge of something nobody can see says nothing, so anything without
          // a drawn box of its own is dropped rather than asserted on.
          return Array.from(dialogElement.querySelectorAll("input, .select"))
            .filter((field) => {
              const style = getComputedStyle(field);
              return style.opacity !== "0" && field.getBoundingClientRect().width > 4;
            })
            .map((field) => {
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

      it("separates a dialog's regions with a rule you can see", async () => {
        // Phase 113 pulled the chrome out of eight dialogs, and the whole of
        // what replaces a card here is two 2px rules and a shadow - "structure
        // is rules and alignment, never cards". A rule that composites to
        // nothing against the fill it is drawn on leaves a dialog whose header
        // and footer are three paragraphs in a box.
        //
        // Measured off the composited stack rather than off `--rule`: it is a
        // translucent ink on light and a translucent white on dark, so its own
        // value says nothing about whether it is visible.
        await openFilterDialog();

        const regions = await browser.execute(() => {
          const dialogElement = document.querySelector<HTMLElement>(".dialog");
          if (dialogElement === null) {
            return null;
          }
          // Kebab-case both times. `getPropertyValue` takes a CSS property
          // name, not the camelCase alias on the style object, and the camel
          // spelling returns "" rather than throwing - which reads downstream
          // as a colour of black and a ratio that looks plausible.
          const read = (selector: string, side: "bottom" | "top") => {
            const found = dialogElement.querySelector<HTMLElement>(selector);
            if (found === null) {
              return null;
            }
            const style = getComputedStyle(found);
            return {
              width: style.getPropertyValue(`border-${side}-width`),
              colour: style.getPropertyValue(`border-${side}-color`),
            };
          };
          return {
            fill: getComputedStyle(dialogElement).backgroundColor,
            shadow: getComputedStyle(dialogElement).boxShadow,
            header: read(".dialog-header", "bottom"),
            footer: read(".dialog-footer", "top"),
          };
        });

        expect(regions).not.toBeNull();

        // Collected rather than asserted one at a time, as the field check
        // above is: `expect` here takes no message, so the list is the failure
        // message and it reports both rules at once.
        const wrong = (["header", "footer"] as const)
          .map((name) => ({ name, rule: regions?.[name] ?? null }))
          .flatMap(({ name, rule }) => {
            if (rule === null) {
              return [`${name}: no rule drawn at all`];
            }
            if (rule.width !== "2px") {
              return [`${name}: rule is ${rule.width}, not the sheet's 2px`];
            }
            // Flattened first: `--rule` is a translucent ink on light and a
            // translucent white on dark, and `contrast` reads a colour as
            // opaque. Measured this way it is 2.43:1 on light and 1.50:1 on
            // dark, so the bar below is what still fails a rule that has been
            // thinned to nothing rather than one the sheet drew.
            const fill = regions?.fill ?? "";
            const ratio = contrast(flatten([rule.colour, fill]), fill);
            return ratio > 1.3
              ? []
              : [`${name}: rule ${rule.colour} on ${fill} = ${ratio.toFixed(2)}:1`];
          });

        expect(wrong).toEqual([]);

        // And the box casts the sheet's dialog shadow rather than the menu's,
        // which is what separates it from the window behind it now that it has
        // no radius and a hairline edge.
        expect(regions?.shadow).toContain("12px");
      });

      it("puts a dialog over the app rather than after it", async () => {
        // The defect: `.dialog` relied on its backdrop for centring, Base UI
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
          [".volume-rail", ".scrubber-rail", ".volume-thumb"],
        );

        // Guards the guard, and it is not hypothetical: a selector that matches
        // nothing contributes no entry, so when the playhead's rail was renamed
        // in phase 35 this test went on passing while measuring two controls
        // instead of three. Every named selector has to be found.
        expect(parts).toHaveLength(3);

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
            ".now-playing-title",
            ".now-playing-subtitle",
            ".scrubber-time",
            ".sidebar-item[aria-current='page']",
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
  }

  it("keeps the whole app bar on one row, inside the window", async () => {
    // The defect this exists for, found by looking at a screenshot rather than
    // by any assertion: the bar was a four-column grid holding four things,
    // and phase 34 gave it seven. Grid auto-placement only moves forward, so
    // the overflow started a second row - the window buttons ended up below
    // the bar and the now-playing display was clipped off the right edge of
    // the window. Every unit test passed.
    const layout = await browser.execute(() => {
      const bar = document.querySelector(".appbar");
      if (bar === null) {
        return null;
      }
      // Every child measured directly. The version used to be wrapped with the
      // caption buttons in a `.titlebar-right` cluster, and unwrapping that was
      // how this test saw the overflow it exists to catch; phase 119 took the
      // buttons, and the wrapper went with them.
      const children = Array.from(bar.children).map((child) => {
        const box = child.getBoundingClientRect();
        return {
          what: child.className.toString() || child.tagName,
          // The vertical centre, not the top - see below.
          middle: Math.round(box.top + box.height / 2),
          right: Math.round(box.right),
        };
      });
      return { children, width: window.innerWidth };
    });

    expect(layout).not.toBe(null);
    const { children, width } = layout as NonNullable<typeof layout>;
    expect(children.length).toBeGreaterThan(2);

    // One row: every child shares the row's vertical centre.
    //
    // Centres rather than tops, which is what the first two versions of this
    // got wrong. The bar was `align-items: center` over children of wildly
    // different heights - a 67px status display beside a 26px button - so
    // their *tops* differed by twenty-odd pixels while they sat in the same
    // row, and every threshold loose enough to allow that was loose enough to
    // miss a real wrap. Centred children have one centre however tall they
    // are, and a wrapped one is a whole row away from it.
    //
    const middle = Math.min(...children.map((child) => child.middle));
    const wrapped = children
      .filter((child) => child.middle > middle + 12)
      .map((child) => `${child.what} sits ${child.middle - middle}px below the row`);

    // And nothing runs off the right edge, which is the other half of the same
    // fault: a row that cannot wrap overflows instead.
    const clipped = children
      .filter((child) => child.right > width + 1)
      .map((child) => `${child.what} runs ${child.right - width}px past the window`);

    expect([...wrapped, ...clipped]).toEqual([]);
  });

  it("fills the play button with the accent, not just a ring of it", async () => {
    // The defect this exists for, and it reached CI: `.transport button` sets
    // the shape for all three transport buttons and `.transport-play` sets the
    // accent fill for the middle one - but the first is a class plus an
    // element and the second is a class alone, so the broader rule won
    // wherever they overlapped however far above it was written. The button
    // rendered as a dark circle with an amber halo round it and nothing in the
    // middle: the app's single most prominent control, absent.
    //
    // Nothing could have caught this by reading the stylesheet, because both
    // rules were correct in isolation. The cascade is a property of the
    // running document, so this asks the running document.
    const play = await browser.execute(() => {
      const button = document.querySelector(".transport-play");
      const pill = document.querySelector(".transport");
      if (button === null || pill === null) {
        return null;
      }
      return {
        fill: getComputedStyle(button).backgroundColor,
        glyph: getComputedStyle(button).color,
        behind: getComputedStyle(pill).backgroundColor,
      };
    });

    expect(play).not.toBe(null);
    const { fill, glyph, behind } = play as NonNullable<typeof play>;

    // Painted at all, first: a transparent fill is what the defect looked like.
    expect(fill).not.toBe("rgba(0, 0, 0, 0)");
    expect(fill).not.toBe("transparent");
    // And it has to stand out from the band it sits in, which is the whole
    // job of the one solid accent fill in the chrome.
    expect(contrast(fill, behind)).toBeGreaterThan(3);
    // The glyph on top of it stays readable, which is what `--on-accent` is
    // for - white on this amber would be 2.60:1.
    expect(contrast(glyph, fill)).toBeGreaterThan(4.5);
  });

  it("stacks the three bands of chrome at the heights the design draws", async () => {
    // The shell phase 35 built, measured rather than assumed: a 3px accent
    // strip, a 36px app bar, a 78px transport strip, and a 27px footer at
    // the other end. Every one of these is stated in the stylesheet, so a
    // value that drifted would be a silent visual regression - the kind only
    // the screenshot catches, and only if somebody looks at it.
    const bands = await browser.execute(() =>
      [".appbar", ".transport-strip", ".statusbar"].map((selector) => {
        const element = document.querySelector(selector);
        return {
          selector,
          height: element === null ? -1 : Math.round(element.getBoundingClientRect().height),
        };
      }),
    );

    expect(bands).toEqual([
      { selector: ".appbar", height: 36 },
      { selector: ".transport-strip", height: 78 },
      { selector: ".statusbar", height: 27 },
    ]);
  });

  it("keeps the whole transport strip on one row, inside the window", async () => {
    // The same fault the app bar had, in the row that inherited its
    // passengers: the strip carries six controls including a 340px playhead
    // and a 200px search field, and a window narrow enough would wrap them.
    const layout = await browser.execute(() => {
      const strip = document.querySelector(".transport-strip");
      if (strip === null) {
        return null;
      }
      const children = Array.from(strip.children).map((child) => {
        const box = child.getBoundingClientRect();
        return {
          what: child.className.toString() || child.tagName,
          // Centres, for the same reason the app bar above measures them:
          // this row holds a 58px pill beside a 14px playhead, so their tops
          // differ by twenty pixels while they sit in the same row.
          middle: Math.round(box.top + box.height / 2),
          right: Math.round(box.right),
        };
      });
      return { children, width: window.innerWidth };
    });

    expect(layout).not.toBe(null);
    const { children, width } = layout as NonNullable<typeof layout>;
    expect(children.length).toBeGreaterThan(4);

    const middle = Math.min(...children.map((child) => child.middle));
    const offenders = [
      ...children
        .filter((child) => child.middle > middle + 12)
        .map((child) => `${child.what} sits ${child.middle - middle}px below the row`),
      ...children
        .filter((child) => child.right > width + 1)
        .map((child) => `${child.what} runs ${child.right - width}px past the window`),
    ];

    expect(offenders).toEqual([]);
  });

  it("draws the accent strip along the top of the window", async () => {
    // Decoration, and the design's most recognisable single element. Drawn as
    // a pseudo-element, so it has no node to query - the height of the strip
    // is the gap between the top of the viewport and the top of the app bar.
    const offset = await browser.execute(() => {
      const bar = document.querySelector(".appbar");
      return bar === null ? -1 : Math.round(bar.getBoundingClientRect().top);
    });

    expect(offset).toBeGreaterThan(0);
  });

  it("draws a palette rather than a default white page, on either ground", async () => {
    // Guards the tests above. They resolve the background by walking up to the
    // first ancestor that paints one, so a stylesheet that failed to load
    // entirely would leave them measuring black text on white - which on the
    // light ground is very nearly the correct answer, and would pass. So this
    // checks both ends: the window has to be near-black on dark *and*
    // near-white on light, and an unstyled page can only be one of those.
    //
    // The fill is on `html`, not `body`: `body` must stay transparent or it
    // paints over the blob layer. See `primitives.css`.
    const measured: Record<Ground, number> = { light: 0, dark: 0 };
    for (const ground of GROUNDS) {
      await setGround(ground);
      const background = await computed("html", "background-color");

      expect(background).not.toBe("");
      // Measured rather than pattern-matched on the string: the engine returns
      // whichever notation the sheet was authored in, and this has to keep
      // meaning the same thing if that ever changes again.
      measured[ground] = luminance(background);
    }
    await clearGround();

    // Every dark surface sits below oklch(0.3), nowhere near the 0.18 relative
    // luminance of a mid grey; every light one is above oklch(0.9).
    expect(measured.dark).toBeLessThan(0.05);
    expect(measured.light).toBeGreaterThan(0.8);
  });

  it("changes the ground from Settings and remembers the choice", async () => {
    // The other half of the theme, and the half the loop above deliberately
    // does not exercise: the loop writes `data-theme` itself, so a store that
    // never wrote the attribute, a preference that never reached SQLite or a
    // select wired to nothing would all leave it green.
    const attribute = () =>
      browser.execute(() => document.documentElement.getAttribute("data-theme"));

    await openSettings();

    for (const choice of ["Dark", "Light"]) {
      await chooseTheme(choice);
      await browser.waitUntil(async () => (await attribute()) === choice.toLowerCase(), {
        timeout: 5000,
        timeoutMsg: `choosing ${choice} left the ground at ${await attribute()} with the control reading ${await browser.$("#theme").getText()}`,
      });
    }

    // Reopened rather than read from the store: the point is that the choice
    // survived the write and comes back as the selected option, which is what
    // a restart would show. Read as text rather than as a value: the trigger
    // is a button now, and what it holds is the option's label.
    await closeSettings();
    await openSettings();

    await expect(browser.$("#theme")).toHaveText("Light");

    await closeSettings();
    await clearGround();
  });

  it("renders in the face the design asks for, at every weight it imports", async () => {
    // Vendored through @fontsource and imported in main.tsx. The computed
    // family says Archivo whether or not the woff2 arrived, so the useful
    // question is what actually loaded: a missing file falls back to the
    // system sans silently, which looks fine and is wrong.
    const family = await computed(".statusbar-zoom-value", "font-family");

    expect(family).toContain("Archivo");

    // Registered faces rather than loaded ones: a weight the visible screen
    // never sets stays unloaded, so `check()` would only ever prove the one
    // the status bar happens to draw. The sheet asks for three.
    const faces = await browser.execute(() => ({
      weights: [...document.fonts]
        .filter((face) => face.family === "Archivo")
        .map((face) => face.weight)
        .sort(),
      prose: document.fonts.check("400 12px Archivo"),
    }));

    expect(faces.weights).toEqual(["400", "600", "800"]);
    // False here means the woff2 never arrived and the screen is a system sans.
    expect(faces.prose).toBe(true);
  });
});
