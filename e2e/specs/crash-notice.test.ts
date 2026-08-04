import { browser, expect } from "@wdio/globals";
import { invoke } from "../invoke";
import { capture } from "../screenshot";

/**
 * The crash notice, provoked by a real crash and photographed.
 *
 * A panic takes the process down before any JavaScript could run, so the only
 * moment the app can say it happened is the *next* launch. That makes this the
 * one feature in the app whose entire surface is unreachable from a unit test:
 * `CrashNotice.test.tsx` renders it against a mocked `lastCrash`, which proves
 * the component and nothing about whether a panic ever produces one.
 *
 * So this crashes the app for real - on a spawned thread, so the process
 * survives - and then reloads the webview, which is the closest thing to the
 * next launch that a running session has. Everything in between is the real
 * path: the hook fires, the formatter runs, the report is appended to the log
 * beside the database, and `last_crash` reads it back out.
 *
 * It also takes the pictures. Those are for the reviewer, not for an
 * assertion; see `screenshot.ts` for why this suite still has no pixel
 * baselines and is not getting any.
 *
 * The notice is a Base UI `AlertDialog`, so it portals to the body and is
 * addressed by role rather than by class - and being an alert dialog rather
 * than a dialog is itself the assertion that a backdrop click cannot make it
 * go away.
 */

/** Waits for the app document, which a reload has to be given time for. */
async function waitForTheApp(): Promise<void> {
  await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
    timeout: 30_000,
    interval: 250,
  });
  await browser.$(".statusbar-summary").waitForExist({ timeout: 30_000 });
}

async function applyTheme(theme: "light" | "dark"): Promise<void> {
  await browser.execute((value: string) => {
    if (value === "light") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = value;
    }
  }, theme);
}

describe("the notice that reports a crash", () => {
  before(async () => {
    await waitForTheApp();

    // A real panic, through the real hook. A hand-written log file would be
    // testing the format against itself.
    await invoke("e2e_provoke_panic");

    // The notice is asked for once on mount, because a crash that has already
    // happened cannot happen again while the app is up. A reload is how a test
    // reaches the next launch without restarting the process.
    await browser.refresh();
    await waitForTheApp();
  });

  it("reports the panic the app actually took", async () => {
    // `alertdialog`, not `dialog`: an alert dialog cannot be dismissed by
    // clicking the backdrop, which is the point of using that Base UI part for
    // a message the user has to actually answer.
    const notice = browser.$("[role='alertdialog']");
    await notice.waitForExist({ timeout: 30_000 });

    await expect(notice).toHaveText(/closed unexpectedly/);
    // The message from the panic itself, not a generic apology: this is the
    // whole round trip - hook, formatter, log file, `last_crash`, IPC, render.
    await expect(browser.$(".crash-notice-summary")).toHaveText(
      /a deliberate panic, provoked by the end-to-end suite/,
    );
  });

  it("shows the backtrace on request, and names the thread that died", async () => {
    await browser.$("//button[text()='Show details']").click();

    const details = browser.$(".crash-notice-details");
    await expect(details).toBeExisting();
    // The thread name is the part that makes a report worth having: a panic on
    // the player thread and one in the scan pool need different answers.
    await expect(details).toHaveText(/thread: e2e-provoked/);
    await expect(details).toHaveText(/backtrace:/);
  });

  it("looks like this", async () => {
    // The photographs. No assertion on their contents - they are for the
    // reviewer of the pull request that changes them.
    const taken: string[] = [];

    for (const theme of ["light", "dark"] as const) {
      await applyTheme(theme);

      // Collapsed and expanded: the second is what a bug report gets pasted
      // from, and it is the one whose layout can push the table off screen.
      const collapsed = browser.$("//button[text()='Show details']");
      if (await collapsed.isExisting()) {
        await collapsed.click();
      }
      if (await capture(`crash-notice-${theme}-expanded`)) {
        taken.push(`${theme}-expanded`);
      }

      await browser.$("//button[text()='Hide details']").click();
      if (await capture(`crash-notice-${theme}`)) {
        taken.push(theme);
      }
    }

    await applyTheme("light");

    // Reported rather than asserted. If this driver turns out not to implement
    // the screenshot endpoint at all, that is worth knowing from the log - and
    // it is not a reason to fail a suite whose subject is a feature that
    // demonstrably works.
    console.log(`\n  captured: ${taken.length > 0 ? taken.join(", ") : "nothing"}\n`);
  });

  it("stays dismissed once dismissed", async () => {
    await browser.$("//button[text()='Dismiss']").click();
    await expect(browser.$("[role='alertdialog']")).not.toBeExisting();

    // The dismissal is recorded against *that* crash rather than the session,
    // so it has to survive a reload. This is the assertion that would have
    // caught storing a boolean instead of the timestamp.
    await browser.refresh();
    await waitForTheApp();
    await expect(browser.$("[role='alertdialog']")).not.toBeExisting();
  });
});
