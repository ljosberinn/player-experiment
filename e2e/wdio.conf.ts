import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const application = join(repoRoot, "src-tauri", "target", "debug", "player.exe");

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
};
