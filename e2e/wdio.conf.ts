import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const application = join(repoRoot, "src-tauri", "target", "debug", "player.exe");

/** Scratch space for the app data of a run, and for generated fixtures. */
const workDir = join(repoRoot, "e2e", ".tmp");

if (!existsSync(application)) {
  throw new Error(
    `${application} is missing - build it first with:\n` +
      `  npm run tauri -- build --debug --no-bundle --features wdio --config src-tauri/tauri.wdio.conf.json`,
  );
}

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.test.ts"],
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

  /** Nothing from a previous run survives into this one. */
  onPrepare() {
    rmSync(workDir, { recursive: true, force: true });
    mkdirSync(workDir, { recursive: true });
  },

  /**
   * Gives the app a library of its own, per spec file.
   *
   * Without this every spec shares the one library under the OS app-data
   * directory - which on a developer's machine is *their* library, and on a
   * runner is whatever the spec before this one left in it. The suite has
   * specs on both sides of that: `library` seeds six tracks, `smoke` asserts
   * on the empty state.
   *
   * This hook runs in the worker process before the app is launched, so the
   * variables reach it through the environment it inherits. Both are read only
   * by a build with the `wdio` feature (see `src-tauri/src/lib.rs`), so setting
   * them against a shipped binary does nothing.
   */
  beforeSession(_config, _capabilities, specs) {
    const name = basename(specs[0] ?? "session").replace(/\.test\.ts$/, "");
    const dataDir = join(workDir, `data-${name}`);
    rmSync(dataDir, { recursive: true, force: true });
    process.env.PLAYER_E2E_DATA_DIR = dataDir;

    // A runner has no audio device, so the app would otherwise fall back to a
    // sink where every load fails - and a row can never be shown playing.
    process.env.PLAYER_E2E_SILENT_AUDIO = "1";
  },
};
