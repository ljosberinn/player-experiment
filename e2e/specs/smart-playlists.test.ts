import { browser, expect } from "@wdio/globals";
import { LIBRARY } from "../fixtures";
import { capture } from "../screenshot";

/**
 * A smart playlist with a cutoff, built through the editor.
 *
 * The half a component test cannot reach. `SmartPlaylistEditor.test.tsx`
 * proves the dialog hands back the order it was given, and the Rust tests
 * prove the query layer applies it - but between the two sit a command, a JSON
 * column and a page query, and "the playlist holds one song" is a fact about
 * all of them at once.
 *
 * The property worth an e2e is the one that makes a cutoff *membership* rather
 * than display: sorting the view must not change which songs are in it. That
 * one is invisible to every layer on its own, because each layer is doing
 * exactly what it should.
 *
 * Since phase 100 a smart playlist opens on its releases, so the rows that
 * property is read off sit behind a drill-in. A cutoff of one is what keeps
 * that reachable: one song is one release, so the drill-in holds the whole
 * playlist and the before-and-after comparison has a screen to run on. A
 * cutoff spanning several releases would have none.
 *
 * Runs after `library.test.ts` because it needs songs to cut off, and before
 * `virtualization.test.ts` because that one fills the library with a hundred
 * and fifty thousand rows and nothing after it would recognise the place.
 */

/** How many songs the playlist under test is limited to. */
const LIMIT = 1;

const NAME = "One Song";

/** The titles on screen, in the order the table puts them. */
function titles(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll("tr.song-row")).map((one) =>
      (one.querySelector("td.song-cell[data-column='title']")?.textContent ?? "").trim(),
    ),
  );
}

/** The sidebar's button for a playlist. Its accessible name is the playlist's
    name, deliberately - the count beside it keeps changing. */
function playlistItem(name: string) {
  return browser.$(`button.sidebar-item[aria-label='${name}']`);
}

/**
 * The sidebar's button for a library view.
 *
 * By its visible label rather than by `aria-label`, which these do not carry:
 * a playlist row has one because its count would otherwise keep renaming it,
 * and Songs has nothing that changes. Addressing both the same way is what
 * made the first version of this spec fail in its cleanup hook.
 */
function libraryView(label: string) {
  return browser.$(
    `//button[contains(@class,'sidebar-item')][.//span[normalize-space(.)='${label}']]`,
  );
}

/**
 * Right-clicks a playlist row, by dispatching the event rather than pressing.
 *
 * `click({ button: "right" })` goes through the Actions API, and against this
 * driver it does not produce a `contextmenu` event at all - the first run of
 * this spec found the menu simply never opened. That is the same limitation
 * `library.test.ts` hit with `doubleClick()`, and the remedy there is the one
 * used here: dispatch the event React is actually listening for.
 *
 * `ContextMenu.Trigger` owns the `contextmenu` event and derives the menu's
 * position from it, so the coordinates are the row's own - a menu opened at
 * 0,0 would be nudged back on screen and could land over its own trigger.
 */
async function openContextMenu(name: string): Promise<void> {
  await browser.execute((playlist: string) => {
    const trigger = document.querySelector(`button.sidebar-item[aria-label='${playlist}']`);
    if (trigger === null) {
      return;
    }
    const box = trigger.getBoundingClientRect();
    trigger.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: Math.round(box.left + box.width / 2),
        clientY: Math.round(box.top + box.height / 2),
      }),
    );
  }, name);
}

/** The release names the grid is drawing. */
function tileTitles(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll("button.browse-tile .browse-title")).map((one) =>
      (one.textContent ?? "").trim(),
    ),
  );
}

async function settledAt(count: number, why: string): Promise<void> {
  await browser.waitUntil(async () => (await titles()).length === count, {
    timeout: 10_000,
    timeoutMsg: why,
  });
}

describe("a smart playlist with a cutoff", () => {
  before(async () => {
    await browser.$(".statusbar-summary").waitForExist({ timeout: 30_000 });
  });

  it("builds one through the editor", async () => {
    // The library has to have more songs than the cutoff, or none of this
    // proves anything at all.
    expect(LIBRARY.length).toBeGreaterThan(LIMIT);

    await browser.$("button[aria-label='New smart playlist']").click();

    // `.dialog-field input` rather than `input[type='text']`: the name field
    // declares no `type` at all, and an attribute selector needs the attribute
    // to be present - the implicit default does not satisfy it. That is what
    // failed here first, and every later failure was this one cascading.
    const name = await browser.$(".dialog-field input");
    await name.waitForExist({ timeout: 10_000 });
    await name.setValue(NAME);

    // No rules at all: every song is a candidate and the cutoff does all the
    // work, which is exactly the shape "Recently Added" ships in - and the
    // only part of this dialog a driver can fill in reliably. A rule on a text
    // field is a combobox whose suggestion list is portalled over what comes
    // next; a rule on Year took `setValue` without complaint and then built a
    // playlist that matched nothing. Neither is what this spec is about.
    // The caption rather than the box: the drawn checkbox wraps its input in a
    // label of its own, so the input is no longer a sibling of this label - and
    // a `<label for>` activates its control whatever the control is drawn as.
    await browser.$("//label[normalize-space(.)='Limited to']").click();
    const limit = await browser.$("input[aria-label='Limit']");
    await limit.setValue(String(LIMIT));

    await browser.$("//button[normalize-space(.)='Save']").click();
    await browser.$(".dialog").waitForExist({ reverse: true, timeout: 10_000 });
  });

  it("opens on its releases, scoped to what it holds", async () => {
    // The landing state and the scope in one: the library has three releases
    // and the playlist shows only the one its single song was recorded for.
    await browser.$(".browse-grid").waitForExist({ timeout: 30_000 });
    await browser.waitUntil(async () => (await tileTitles()).length === LIMIT, {
      timeout: 15_000,
      timeoutMsg: `the release grid never settled at ${LIMIT} tile`,
    });

    // The sidebar count runs through the same scope the grid did, so a
    // disagreement here means the cutoff reached one and not the other.
    await expect(playlistItem(NAME).$(".sidebar-count")).toHaveText(String(LIMIT));

    // The landing state is the point of phase 100, and the tiles and the
    // highlighted sidebar row only read as one picture together.
    await capture("smart-playlist-releases");
  });

  it("holds the same songs however the view is sorted", async () => {
    // The only tile there is, which is the whole playlist: what the comparison
    // below needs is one screen holding everything the cutoff kept.
    await browser.$("button.browse-tile").click();
    await settledAt(LIMIT, `the drill-in never settled at ${LIMIT} rows`);
    const before = (await titles()).slice().sort();
    expect(before).toHaveLength(LIMIT);

    // Clicking a column header sorts the *display*. If the cutoff had been a
    // LIMIT on the page query rather than a condition on the scope, this would
    // quietly hand back a different song - with every layer behaving perfectly
    // on its own.
    const header = await browser.$("th[data-column='title']");
    await header.click();
    await settledAt(LIMIT, "the row count changed when the view was sorted");
    expect((await titles()).slice().sort()).toEqual(before);

    // And reversed, which is the case that would flip the membership subquery's
    // own order if the two were ever the same clause.
    await header.click();
    await settledAt(LIMIT, "the row count changed when the sort was reversed");
    expect((await titles()).slice().sort()).toEqual(before);
  });

  it("reopens the editor on the cutoff it was saved with", async () => {
    // Through the row's own menu, which is the only route to it - double
    // clicking a playlist starts a rename instead.
    await openContextMenu(NAME);
    await browser.$("//*[@role='menuitem'][contains(., 'Edit Filter')]").click();

    const limit = await browser.$("input[aria-label='Limit']");
    await limit.waitForExist({ timeout: 10_000 });

    // The round trip no component test can make: through the command, into
    // `sort_json`, and back out into the dialog.
    await expect(limit).toHaveValue(String(LIMIT));

    await browser.$("//button[normalize-space(.)='Cancel']").click();
    await browser.$(".dialog").waitForExist({ reverse: true, timeout: 10_000 });
  });

  after(async () => {
    // Escape first, unconditionally. This is the first spec in the suite to
    // drive a *context* menu, and if that turns out not to work in the
    // embedded driver the test above fails with a dialog or a menu still open
    // - whose backdrop would swallow the click below and fail the cleanup as
    // well, hiding which one was the real failure.
    await browser.keys(["Escape"]);

    // The specs share one library. Leaving a playlist selected would hand the
    // next one a two-row view where it expects the whole library.
    await libraryView("Songs").click();
  });
});
