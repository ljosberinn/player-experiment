import { browser, expect } from "@wdio/globals";
import { emit } from "../invoke";
import { capture } from "../screenshot";

/**
 * The readout at the foot of the sidebar, for a task measured in days.
 *
 * The unattended lookup pass is the only thing that reports on
 * `task://progress`. It needs the network, it is off by default and it runs for
 * the better part of two days, so no spec can start one - the payload is sent
 * from the webview instead and Tauri routes it back through the backend to the
 * listener, which is exactly the path the real thing takes. What that leaves
 * untested here is the arithmetic behind the numbers, and `Pace` in
 * `library::worker` covers that.
 *
 * A screenshot because a standing readout is worth capturing going forward:
 * `taskSummary.test.ts` proves the words and `App.renders.test.tsx` proves it
 * costs the window nothing, but neither can say whether a line pinned to the
 * bottom of the sidebar sits where the sidebar ends.
 */

const TASK = {
  label: "Looking up releases",
  done: 402,
  total: 8044,
  etaMs: 45 * 3_600_000,
};

async function waitForTheApp(): Promise<void> {
  await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
    timeout: 30_000,
    interval: 250,
  });
  await browser.$(".statusbar-summary").waitForExist({ timeout: 30_000 });
}

describe("the progress readout", () => {
  before(async () => {
    await waitForTheApp();
  });

  after(async () => {
    // Whatever this spec did, the next one finds a sidebar with no task in it.
    await emit("task://progress", null);
    await browser.$(".sidebar-task").waitForExist({ reverse: true, timeout: 10_000 });
  });

  it("is absent until something is running", async () => {
    await expect(browser.$(".sidebar-task")).not.toBeExisting();
  });

  it("says what is running, how far it has got and how much longer", async () => {
    await emit("task://progress", TASK);

    const line = browser.$(".sidebar-task");
    await line.waitForExist({ timeout: 10_000 });
    // Two decimals because one whole percent of this pass is eighty releases
    // and the better part of half an hour, and a figure that does not move for
    // half an hour reads as hung.
    await expect(line).toHaveText("Looking up releases · 5.00% · about 45 hours left");

    await capture("sidebar-task-progress");
  });

  it("goes away when the task ends", async () => {
    await emit("task://progress", TASK);
    await browser.$(".sidebar-task").waitForExist({ timeout: 10_000 });

    await emit("task://progress", null);

    await expect(browser.$(".sidebar-task")).not.toBeExisting();
  });
});
