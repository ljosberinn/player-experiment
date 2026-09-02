import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { chooseFromMenu } from "../menu";

/**
 * `main.log`, written by the app and read from disk.
 *
 * The one thing no unit test can check: `log::tests` proves the format and the
 * rotation against a temp file, and says nothing about whether the running app
 * ever opens one, or opens it beside the library rather than in the
 * developer's own app-data directory. That is what this reads back.
 *
 * The file is read with `node:fs` rather than through the app, because the
 * point is that the bytes are on disk where they were promised - a command
 * that answered with its own idea of the contents would prove nothing.
 *
 * Placed after `library`, so the scan it asks for has music to find.
 */

/** Where the app was told to keep its data, set at the top of `wdio.conf.ts`. */
const logPath = join(process.env.PLAYER_E2E_DATA_DIR ?? "", "main.log");

function lines(): string[] {
  return existsSync(logPath) ? readFileSync(logPath, "utf8").split("\n") : [];
}

/** The last line naming `operation`, once one arrives. */
async function waitForLine(operation: string): Promise<string> {
  let found = "";
  await browser.waitUntil(
    async () => {
      const matching = lines().filter((line: string) => line.includes(` ${operation} `));
      found = matching[matching.length - 1] ?? "";
      return found !== "";
    },
    { timeout: 120_000, interval: 500, timeoutMsg: `nothing was written down for ${operation}` },
  );
  return found;
}

describe("the file every operation is written down in", () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()) === "Apex", {
      timeout: 30_000,
      interval: 500,
    });
    await browser.$(".menubar").waitForExist({ timeout: 30_000 });
  });

  it("lands beside the library rather than wherever the OS would put it", async () => {
    // The e2e build is pointed at its own data directory, and the log has to
    // follow the database there: a test build writing into the developer's
    // real app-data folder is the failure this asserts against.
    const opened = await waitForLine("db.open");

    expect(opened).toContain("library.sqlite3");
    expect(opened).toContain(process.env.PLAYER_E2E_DATA_DIR ?? "");
  });

  it("writes a line for a scan the user asked for", async () => {
    await chooseFromMenu("File", "Rescan");

    const scanned = await waitForLine("scan");

    // Timestamp, outcome, operation, then `key=value` - the shape the whole
    // file is meant to be readable as.
    expect(scanned).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z ok {2}scan +added=\d+ updated=\d+ missing=\d+ returned=\d+ ms=\d+$/,
    );
  });

  it("says nothing about the reads behind a window that is only being looked at", async () => {
    // Every page the table asks for is a `tracks.query`, and a line each would
    // rotate the file past the operation somebody is actually investigating.
    // Their failures are logged; their successes are not.
    expect(lines().filter((line) => line.includes(" tracks.query "))).toHaveLength(0);
  });
});
