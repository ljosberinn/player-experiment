#!/usr/bin/env node
/**
 * Fails when a Tauri package's npm half and Rust half disagree on major.minor.
 *
 * `tauri build` refuses to start on such a mismatch, so without this the first
 * report comes from the e2e job, several minutes into a debug build, in a log
 * nobody reads to the end. The mismatch is also the normal outcome of an
 * automated bump rather than an unlucky one: Dependabot groups per ecosystem
 * and cannot bump `tauri-plugin-updater` and `@tauri-apps/plugin-updater` in
 * one pull request, so every Tauri update arrives as one half and is red by
 * construction until the other half is pushed on top.
 *
 * Versions come from the lockfiles, because those are what an install
 * resolves to and so what the CLI compares. Only packages present on both
 * sides are checked - `tauri-plugin-fs` has no npm counterpart, and a JS-only
 * plugin has no crate.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Patch releases are allowed to drift; the CLI compares major and minor. */
const series = (version) => version.split(".").slice(0, 2).join(".");

const cargoLock = readFileSync(join(root, "src-tauri", "Cargo.lock"), "utf8");

const crates = new Map();
for (const block of cargoLock.split("[[package]]")) {
  const name = block.match(/^name = "(.+)"$/m)?.[1];
  const version = block.match(/^version = "(.+)"$/m)?.[1];
  if (name && version) {
    crates.set(name, version);
  }
}

const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

/** `@tauri-apps/api` is the one pair whose two halves are not named alike. */
const crateFor = (npmName) =>
  npmName === "@tauri-apps/api" ? "tauri" : npmName.replace("@tauri-apps/plugin-", "tauri-plugin-");

const mismatches = [];
let checked = 0;
for (const [path, entry] of Object.entries(lock.packages)) {
  const npmName = path.replace(/^node_modules\//, "");
  if (!npmName.startsWith("@tauri-apps/") || !entry.version) {
    continue;
  }

  const crateVersion = crates.get(crateFor(npmName));
  if (!crateVersion) {
    continue;
  }

  checked += 1;
  if (series(crateVersion) !== series(entry.version)) {
    mismatches.push(`${crateFor(npmName)} (v${crateVersion}) : ${npmName} (v${entry.version})`);
  }
}

if (mismatches.length > 0) {
  console.error("Mismatched Tauri packages - the npm and Rust halves must move together:");
  for (const mismatch of mismatches) {
    console.error(`  ${mismatch}`);
  }
  console.error("\nBump the lagging half to the same major.minor and commit both lockfiles.");
  process.exit(1);
}

console.log(`${checked} Tauri packages agree across both lockfiles.`);
