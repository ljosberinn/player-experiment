import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const application = join(repoRoot, "src-tauri", "target", "debug", "apex.exe");

/** Scratch space for the app data of a run, and for generated fixtures. */
const workDir = join(repoRoot, "e2e", ".tmp");

// At module scope, not in a hook, and this is not an accident.
//
// `@wdio/tauri-service` spawns the app in the launcher process during its own
// `onPrepare`, and hook order between a service and this file is not something
// either of them promises. Anything set in `onPrepare` or `beforeSession` may
// therefore arrive after the app has already read its environment - which is
// exactly what happened the first time this was written, and the symptom was a
// spec asserting on an empty library finding six tracks in it.
//
// Importing this file happens before any of that, so setting them here is the
// one placement that cannot lose the race.
//
// The wipe is guarded, and that guard is the whole reason this comment is
// three paragraphs long. **Every worker imports this file too**, so an
// unguarded `rmSync` at module scope deletes the live SQLite file out from
// under the app the launcher already started - which is what happened, and
// the failure read "unable to open database file" from a command that had
// worked seconds earlier. `WDIO_WORKER_ID` is set in workers and not in the
// launcher, so only the launcher clears the directory.
if (process.env.WDIO_WORKER_ID === undefined) {
  rmSync(workDir, { recursive: true, force: true });
}
mkdirSync(workDir, { recursive: true });

// Keeps the run out of the OS app-data directory, which on a developer's
// machine holds *their* library. Read only by a build carrying the `wdio`
// feature, so setting it against a shipped binary does nothing.
process.env.PLAYER_E2E_DATA_DIR = join(workDir, "data");
// A runner has no audio device, so the app would otherwise fall back to a sink
// where every load fails by design - and no row could ever be shown playing.
process.env.PLAYER_E2E_SILENT_AUDIO = "1";

if (!existsSync(application)) {
  throw new Error(
    `${application} is missing - build it first with:\n` +
      `  npm run tauri -- build --debug --no-bundle --features wdio --config src-tauri/tauri.wdio.conf.json`,
  );
}

export const config: WebdriverIO.Config = {
  runner: "local",
  // Listed rather than globbed, because the order matters and a glob would
  // hide that. One app process serves the whole run - the service spawns it
  // once and each spec file opens a new session against it - so the specs
  // share one library, and the one that puts music in it has to go last.
  // `library` asserts the library is empty before it seeds, so an accidental
  // reorder fails as itself rather than as a puzzle three specs later.
  specs: [
    "./specs/smoke.test.ts",
    "./specs/appearance.test.ts",
    // Before the library is seeded, deliberately: the File menu's third entry
    // appears only when songs are missing, and "no third entry" is the case
    // worth asserting - an empty library cannot be missing anything.
    "./specs/menus.test.ts",
    "./specs/library.test.ts",
    // Last but one, and it has to be after the rest: it puts a hundred and
    // fifty thousand rows in the shared library and nothing before it would
    // recognise the place afterwards.
    "./specs/virtualization.test.ts",
    // Truly last. It crashes the app on purpose, and the notice that reports
    // the crash sits above the table until something dismisses it - which this
    // spec does, but only if it gets that far.
    "./specs/crash-notice.test.ts",
  ],
  maxInstances: 1,
  // @wdio/tauri-service owns the driver lifecycle. The default `embedded`
  // provider runs the WebDriver server inside the app itself (via
  // tauri-plugin-wdio-webdriver), so neither tauri-driver nor msedgedriver is
  // involved - that external pair is what kept failing session creation with
  // "DevToolsActivePort file doesn't exist".
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: application,
        driverProvider: "embedded",
        captureBackendLogs: true,
        captureFrontendLogs: true,
      },
    ],
  ],
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": { application },
    } as unknown as WebdriverIO.Capabilities,
  ],
  reporters: ["spec"],
  framework: "mocha",
  // Generous: on failure the spec probes the webview, and each probe can block
  // for seconds against a stalled one. A tighter budget loses the diagnostics
  // to a Mocha timeout, which is exactly what happened before.
  mochaOpts: { ui: "bdd", timeout: 180_000 },
  waitforTimeout: 10_000,
};
