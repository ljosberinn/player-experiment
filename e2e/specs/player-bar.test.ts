import { browser, expect } from "@wdio/globals";
import { contrast, flatten } from "../contrast";
import { invoke } from "../invoke";
import { illegible } from "../legibility";
import { playRow, waitForStatus } from "../playback";
import { capture } from "../screenshot";
import { clearGround, GROUNDS, setGround } from "../theme";

/**
 * The band at the foot of the window, which is there only while a song is
 * loaded - so this runs after `library.test.ts` has put songs in the table,
 * and starts one.
 *
 * Mute and repeat-one are backend state reached through a button, and the half
 * no component test can see is the round trip: `chrome.test.tsx` proves the
 * button reports a click and draws its pressed state against props a test
 * supplies, and `store.test.ts` proves the command is sent - neither says the
 * player ever hears it, nor that what comes back on `player://state` is what
 * went out.
 *
 * A reload is how a spec reaches "the window opened again" without restarting
 * the process, the same trick the sidebar and crash specs use. Note what that
 * does and does not prove: the player thread outlives a webview reload, so
 * what is asserted after one is that the controls take their state from the
 * backend rather than from a default. That mute *reaches SQLite*, and what a
 * genuinely fresh process reads back out of it, is `settings::muted` and its
 * Rust tests - a spec cannot restart the app it is driving.
 *
 * The layout and colour checks were in `appearance.test.ts` until 153, which
 * runs before there is anything to load.
 */

function muteButton() {
  return browser.$(".volume-mark");
}

function repeatButton() {
  return browser.$(".repeat-button");
}

async function waitForTheApp(): Promise<void> {
  await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
    timeout: 30_000,
    interval: 250,
  });
  await browser.$("tr.song-row").waitForExist({ timeout: 30_000 });
}

/** What the player itself says, which is the thing the buttons are drawing. */
function snapshot(): Promise<{ volume: number; muted: boolean; repeatOne: boolean }> {
  return invoke("player_snapshot");
}

/**
 * Puts a toggle into the state a test needs, whatever state it is in.
 *
 * These specs share one app process, so a test that failed halfway leaves the
 * transport however it got to, and the next one asserting from a guessed
 * starting point fails as a puzzle rather than as itself.
 */
async function setPressed(button: ReturnType<typeof muteButton>, pressed: boolean): Promise<void> {
  if ((await button.getAttribute("aria-pressed")) !== String(pressed)) {
    await button.click();
  }
}

describe("the player bar", () => {
  before(async () => {
    await waitForTheApp();
    await playRow(0);
    await browser.$(".player-bar").waitForExist({ timeout: 10_000 });
  });

  after(async () => {
    // Whatever this spec did, the next one starts with an audible, stopped
    // player that advances its queue - which is what every spec after it
    // assumes. The buttons first: they go with the bar.
    if (await browser.$(".player-bar").isExisting()) {
      await setPressed(muteButton(), false);
      await setPressed(repeatButton(), false);
    }
    await invoke("player_stop");
  });

  it("mutes and unmutes without forgetting the level", async () => {
    await setPressed(muteButton(), false);
    const before = await snapshot();

    await muteButton().click();

    await expect(muteButton()).toHaveAttribute("aria-pressed", "true");
    await browser.waitUntil(async () => (await snapshot()).muted, {
      timeout: 10_000,
      timeoutMsg: "the player never reported itself muted",
    });
    // The whole point of mute being its own state: the level is untouched, so
    // there is something to come back to.
    expect((await snapshot()).volume).toBe(before.volume);
    // And the rail on screen still shows it rather than dropping to zero.
    //
    // `input[type=range]`, not `[role='slider']`, which is what the first
    // version asked for and which matched nothing: Base UI's thumb renders a
    // visually-hidden range input, and a range input's slider role is
    // *implicit* - there is no role attribute for a CSS selector to find. It
    // read as an empty string and failed as "the rail lost its value".
    const shown = await browser.execute(() => {
      const rail = document.querySelector<HTMLInputElement>(".volume-slider input[type='range']");
      return rail === null ? "" : (rail.getAttribute("aria-valuenow") ?? rail.value);
    });
    expect(shown).toBe(String(Math.round(before.volume * 100)));

    await muteButton().click();

    await expect(muteButton()).toHaveAttribute("aria-pressed", "false");
    await browser.waitUntil(async () => !(await snapshot()).muted, { timeout: 10_000 });
    expect((await snapshot()).volume).toBe(before.volume);
  });

  it("turns repeat on and off", async () => {
    await setPressed(repeatButton(), false);

    await repeatButton().click();

    await expect(repeatButton()).toHaveAttribute("aria-pressed", "true");
    await browser.waitUntil(async () => (await snapshot()).repeatOne, {
      timeout: 10_000,
      timeoutMsg: "the player never reported repeat on",
    });

    await capture("transport-mute-repeat");

    await repeatButton().click();
    await browser.waitUntil(async () => !(await snapshot()).repeatOne, { timeout: 10_000 });
  });

  it("draws what the player holds when the window comes back", async () => {
    // One on and one off, so what comes back can be told apart from a blanket
    // default in either direction.
    await setPressed(muteButton(), true);
    await setPressed(repeatButton(), false);
    await browser.waitUntil(async () => (await snapshot()).muted, { timeout: 10_000 });

    await browser.refresh();
    await waitForTheApp();

    await expect(muteButton()).toHaveAttribute("aria-pressed", "true");
    await expect(repeatButton()).toHaveAttribute("aria-pressed", "false");
  });

  for (const ground of GROUNDS) {
    describe(`on the ${ground} ground`, () => {
      before(async () => {
        await setGround(ground);
      });

      after(async () => {
        await clearGround();
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

      it("keeps what is playing legible against what it sits on", async () => {
        expect(
          await illegible([".now-playing-title", ".now-playing-subtitle", ".scrubber-time"]),
        ).toEqual([]);
      });
    });
  }

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

  it("stacks the bands of chrome in order, at the heights the stylesheet states", async () => {
    // A 3px accent strip, a 40px app bar, the body, and the 100px player bar
    // at the very bottom since 142. The status bar between the last two went
    // in 152. Every one of these is
    // stated in the stylesheet, so a value that drifted would be a silent
    // visual regression - the kind only the screenshot catches, and only if
    // somebody looks at it.
    const measured = await browser.execute(() => ({
      bands: [".appbar", ".body", ".player-bar"].map((selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return {
          selector,
          top: box === undefined ? -1 : Math.round(box.top),
          bottom: box === undefined ? -1 : Math.round(box.bottom),
        };
      }),
      height: window.innerHeight,
    }));

    const heights = Object.fromEntries(
      measured.bands.map((band) => [band.selector, band.bottom - band.top]),
    );
    expect(heights).toMatchObject({ ".appbar": 40, ".player-bar": 100 });

    // Each band starts where the one above it ends, and nothing is below the
    // player bar.
    const gaps = measured.bands
      .slice(1)
      .map((band, index) => ({ band, above: measured.bands[index] }))
      .filter(({ band, above }) => above !== undefined && Math.abs(band.top - above.bottom) > 1)
      .map(({ band, above }) => `${band.selector} starts at ${band.top}, not ${above?.bottom}`);
    expect(gaps).toEqual([]);
    expect(Math.abs((measured.bands.at(-1)?.bottom ?? 0) - measured.height)).toBeLessThanOrEqual(1);
  });

  it("keeps the player bar's columns on one row, with Play over the middle", async () => {
    // Three columns, the outer two equal, so the centre column - and the play
    // button over the rail in it - stays centred in the window whatever the
    // title on the left runs to.
    const layout = await browser.execute(() => {
      const bar = document.querySelector(".player-bar");
      const play = document.querySelector(".transport-play")?.getBoundingClientRect();
      const rail = document.querySelector(".scrubber-rail")?.getBoundingClientRect();
      if (bar === null || play === undefined || rail === undefined) {
        return null;
      }
      const columns = Array.from(bar.children).map((child) => {
        const box = child.getBoundingClientRect();
        return {
          what: child.className.toString(),
          // Centres rather than tops: the centre column is two rows tall and
          // the other two are one.
          middle: Math.round(box.top + box.height / 2),
          right: Math.round(box.right),
        };
      });
      return {
        columns,
        width: window.innerWidth,
        play: play.left + play.width / 2,
        rail: rail.left + rail.width / 2,
      };
    });

    expect(layout).not.toBe(null);
    const { columns, width, play, rail } = layout as NonNullable<typeof layout>;
    expect(columns.length).toBe(3);

    const middle = Math.min(...columns.map((column) => column.middle));
    const offenders = [
      ...columns
        .filter((column) => column.middle > middle + 12)
        .map((column) => `${column.what} sits ${column.middle - middle}px below the row`),
      ...columns
        .filter((column) => column.right > width + 1)
        .map((column) => `${column.what} runs ${column.right - width}px past the window`),
    ];

    expect(offenders).toEqual([]);
    expect(Math.abs(play - width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(play - rail)).toBeLessThanOrEqual(2);
  });

  it("stays through a pause, and goes on a stop", async () => {
    await browser.$("button[aria-label='Pause']").click();
    await waitForStatus("paused");
    await expect(browser.$(".player-bar")).toBeExisting();

    await invoke("player_stop");
    await waitForStatus("stopped");
    await browser.$(".player-bar").waitForExist({ timeout: 10_000, reverse: true });

    // The content takes the height back.
    const bodyBottom = await browser.execute(() =>
      Math.round(document.querySelector(".body")?.getBoundingClientRect().bottom ?? -1),
    );
    const height = await browser.execute(() => window.innerHeight);
    expect(Math.abs(bodyBottom - height)).toBeLessThanOrEqual(1);
  });

  it("comes back on Space, which resumes the queue a stop kept", async () => {
    await browser.$("tr.song-row").click();
    await browser.keys([" "]);

    await waitForStatus("playing");
    await browser.$(".player-bar").waitForExist({ timeout: 10_000 });
  });
});
