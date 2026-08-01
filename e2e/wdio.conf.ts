import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const repoRoot = resolve(import.meta.dirname, "..");
const application = join(repoRoot, "src-tauri", "target", "debug", "player.exe");

let tauriDriver: ChildProcess | undefined;

// `tauri:options` is a vendor extension tauri-driver reads; it is not part of
// the WebDriver capability types, hence the cast.
const capability = {
  browserName: "wry",
  "tauri:options": { application },
} as unknown as WebdriverIO.Capabilities;

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.test.ts"],
  maxInstances: 1,
  hostname: "127.0.0.1",
  port: 4444,
  // tauri-driver is a plain WebDriver server rather than a browser vendor's,
  // so wdio talks to it directly instead of managing a browser itself.
  capabilities: [capability],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  waitforTimeout: 10_000,

  onPrepare: () => {
    if (!existsSync(application)) {
      throw new Error(
        `${application} is missing - run \`npm run tauri -- build --debug --no-bundle\` first`,
      );
    }

    // `cargo install tauri-driver` puts the binary on PATH; the Edge driver
    // location differs between a GitHub runner and a dev machine.
    const nativeDriver =
      process.env.MSEDGEDRIVER ?? "C:\\SeleniumWebDrivers\\EdgeDriver\\msedgedriver.exe";
    if (!existsSync(nativeDriver)) {
      throw new Error(`msedgedriver not found at ${nativeDriver} - set MSEDGEDRIVER to its path`);
    }

    tauriDriver = spawn("tauri-driver", ["--native-driver", nativeDriver], {
      stdio: [null, process.stdout, process.stderr],
      shell: true,
    });
  },

  onComplete: () => {
    tauriDriver?.kill();
  },
};
