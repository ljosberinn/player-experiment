import { browser, expect } from "@wdio/globals";
import { LIBRARY } from "../fixtures";
import { invoke } from "../invoke";
import { chooseFromMenu } from "../menu";
import { capture } from "../screenshot";

/**
 * The background that follows the music, in the app that extracts it.
 *
 * This is the one feature in the app whose whole chain is invisible to every
 * other kind of test. `palette.rs` proves the algorithm on pixels, `covers.rs`
 * proves the column caches them, `DynamicBackground.test.tsx` proves the
 * component writes three custom properties, and `App.css.test.ts` proves the
 * stylesheet reads them - and every one of those can pass while the colours
 * never leave SQLite, because jsdom has no stylesheet and Rust has no webview.
 *
 * What is asserted here is the join: a real mp3, with a real embedded PNG, read
 * by `lofty`, decoded by `image`, cached in `covers.palette`, carried on
 * `player://state`, and arriving in `getComputedStyle` as the colours the
 * picture was made of.
 *
 * Runs after `library`, which is what puts songs in the shared library, and
 * before `virtualization`, which replaces them with a hundred and fifty
 * thousand synthetic rows that have no artwork at all.
 */

/** The album with artwork, and the one without. Both are in the fixture. */
const WITH_COVER = LIBRARY.find((track) => track.cover !== undefined);
const WITHOUT_COVER = LIBRARY.find((track) => track.cover === undefined);

function layer() {
  return browser.$(".dynamic-bg");
}

/** The three colours the layer is actually painting, as the engine sees them. */
function paintedColours(): Promise<string[]> {
  return browser.execute(() => {
    const element = document.querySelector(".dynamic-bg");
    if (element === null) {
      return [];
    }
    const style = getComputedStyle(element);
    return ["--blob-1", "--blob-2", "--blob-3"].map((name) => style.getPropertyValue(name).trim());
  });
}

/** `rgb(r, g, b)` the way a computed style spells it, whatever the input was. */
function asComputed([r, g, b]: readonly [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Plays the track whose title is `title`.
 *
 * The same real-click-then-dispatched-dblclick that `library.test.ts` explains
 * at length: the Actions API's two presses do not coalesce into a `dblclick`
 * against this driver.
 */
async function play(title: string): Promise<void> {
  const index = await browser.execute((wanted: string) => {
    // The first cell past the status marker is Title, in the default layout
    // this spec runs under. Cells carry no per-column class - see `rows()` in
    // `library.test.ts`, which reads them by position for the same reason.
    const found = Array.from(document.querySelectorAll("tr.song-row")).find(
      (row) => row.querySelector("td.song-cell:not(.status)")?.textContent?.trim() === wanted,
    );
    return found?.getAttribute("aria-rowindex") ?? "";
  }, title);

  if (index === "") {
    // Thrown rather than asserted: `expect` from `@wdio/globals` takes no
    // message, and "expected '' not to be ''" would name nothing.
    throw new Error(`no row is showing "${title}" - the view is not the songs list`);
  }

  await browser.$(`tr.song-row[aria-rowindex='${index}']`).click();
  await browser.execute((rowIndex: string) => {
    document
      .querySelector(`tr.song-row[aria-rowindex='${rowIndex}']`)
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }, index);

  await browser.waitUntil(
    async () =>
      (await invoke<{ track: { title: string } | null }>("player_snapshot")).track?.title === title,
    { timeout: 30_000, timeoutMsg: `the player never reported "${title}" playing` },
  );
}

/** Sets the Settings checkbox, and closes the dialog again. */
async function setPreference(on: boolean): Promise<void> {
  await chooseFromMenu("Edit", "Settings…");
  await browser.$("[role='dialog']").waitForExist({ timeout: 10_000 });

  const checkbox = browser.$("#dynamic-background");
  if ((await checkbox.isSelected()) !== on) {
    await checkbox.click();
  }

  await browser.$("//button[text()='Done']").click();
  await browser.$("[role='dialog']").waitForExist({ timeout: 10_000, reverse: true });
}

describe("the background that follows the music", () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
      timeout: 30_000,
      interval: 500,
    });
    // Songs, explicitly. The spec before this one opens smart playlists, and
    // a spec that assumed whatever view it inherited would fail about a
    // missing row rather than about the view it was looking at.
    await browser.$("//*[@class='sidebar-label'][text()='Songs']").click();

    // The library `library.test.ts` seeded, which this spec plays out of.
    await browser.waitUntil(async () => (await browser.$$("tr.song-row").length) > 0, {
      timeout: 30_000,
      timeoutMsg: "the shared library is empty - has the spec order changed?",
    });
  });

  after(async () => {
    // On, which is the app's default, so nothing after this sees a background
    // that is missing for a reason it cannot find.
    await setPreference(true);
    await invoke("player_stop");
  });

  it("takes its colours from the cover of what is playing", async () => {
    await setPreference(true);
    await play(WITH_COVER?.title ?? "");

    await layer().waitForExist({
      timeout: 30_000,
      timeoutMsg: "no background appeared behind a track with artwork",
    });

    // What the backend extracted, which is the half no frontend test sees.
    const snapshot = await invoke<{ palette: { r: number; g: number; b: number }[] | null }>(
      "player_snapshot",
    );
    expect(snapshot.palette).toHaveLength(3);

    // And what the engine is painting with it. Compared as a set: the palette
    // is ordered by how much of the cover each colour covers, and this one is
    // three pixels of equal weight, so the order between them says nothing
    // worth asserting. That all three arrive, unchanged, does.
    const painted = await paintedColours();
    expect([...painted].sort()).toEqual([...(WITH_COVER?.cover ?? [])].map(asComputed).sort());

    // And that they are actually being drawn with. Three colours arriving in
    // three custom properties nothing paints is exactly what happened first:
    // the gradients asked for `circle 34%`, a circle's radius may not be a
    // percentage, and the engine dropped the whole `background` declaration.
    // The layer was there, the colours were there, and it painted nothing.
    const gradients = await browser.execute(() => {
      const element = document.querySelector(".dynamic-bg");
      return element === null ? "" : getComputedStyle(element, "::before").backgroundImage;
    });
    expect(gradients).toContain("radial-gradient");
    expect(gradients.match(/radial-gradient/g)).toHaveLength(3);

    await capture("dynamic-background-with-cover");
  });

  it("draws nothing behind a track with no artwork", async () => {
    await play(WITHOUT_COVER?.title ?? "");

    // Absent from the DOM, not merely transparent: the component returns null
    // rather than an invisible fixed layer under a blur.
    await layer().waitForExist({
      timeout: 30_000,
      reverse: true,
      timeoutMsg: "a background stayed behind a track with no artwork",
    });

    const snapshot = await invoke<{ palette: unknown }>("player_snapshot");
    expect(snapshot.palette).toBe(null);

    await capture("dynamic-background-no-cover");
  });

  it("turns off from Settings, and comes back", async () => {
    await play(WITH_COVER?.title ?? "");
    await layer().waitForExist({ timeout: 30_000 });

    await setPreference(false);

    await layer().waitForExist({
      timeout: 10_000,
      reverse: true,
      timeoutMsg: "the background survived being switched off",
    });
    // Still playing, and the backend still knows the colours - the switch is
    // about drawing them, not about extracting them.
    const snapshot = await invoke<{ palette: unknown }>("player_snapshot");
    expect(snapshot.palette).not.toBe(null);

    await setPreference(true);

    await layer().waitForExist({ timeout: 10_000 });
  });

  it("remembers being switched off when the window comes back", async () => {
    await setPreference(false);

    await browser.refresh();
    await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
      timeout: 30_000,
      interval: 500,
    });
    await browser.$(".transport-strip").waitForExist({ timeout: 30_000 });

    // The preference is read at startup, so a reload is where a default of
    // "on" would quietly win over a stored "off".
    await layer().waitForExist({
      timeout: 10_000,
      reverse: true,
      timeoutMsg: "the background came back on after a reload",
    });
  });
});
