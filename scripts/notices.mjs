#!/usr/bin/env node
/**
 * Regenerates THIRD-PARTY-NOTICES.md from what the app actually links.
 *
 * The app is MIT, which asks nothing of anyone. Its dependencies are not: MIT,
 * BSD and ISC all require their copyright notice to travel with a binary, and
 * symphonia - the mp3 decoder, and so the single most load-bearing crate here -
 * is MPL-2.0, which additionally requires that recipients be told where to get
 * the source of the MPL-covered files. A released installer that carries none
 * of this is out of compliance no matter how permissive the licences are.
 *
 * Run with `npm run notices`. CI re-runs it and fails if the result differs,
 * the same drift check the generated ts-rs bindings get - a notices file is
 * only useful if it describes the current dependency set rather than the one
 * from whenever somebody last remembered.
 *
 * # What is included, and why it over-includes
 *
 * Rust: every package in the resolved graph for the Windows target except this
 * one. That is broader than what links into the binary - it sweeps in build
 * scripts and proc macros that run at compile time and ship nothing. Narrowing
 * it correctly means walking the resolve graph by dependency kind, which is
 * fiddly and fails in the dangerous direction if it is wrong. Attributing a
 * crate that ships no code is harmless; missing one that does is not.
 *
 * npm: the production entries of `package-lock.json`. Dev dependencies are not
 * over-included the same way because the lockfile states the distinction
 * exactly and the tree is large - Vite, Biome, Vitest and WebdriverIO are build
 * and test tooling whose code never reaches the bundle. That also means the
 * notices job can install with `--omit=dev`: the package list comes from the
 * lockfile either way, and only production directories are read for text.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUTPUT = join(root, "THIRD-PARTY-NOTICES.md");

/** Licence files ship under many names; these are the ones actually seen. */
const LICENSE_FILE = /^(LICENSE|LICENCE|COPYING|NOTICE)([-.].*)?$/i;

/**
 * Licences whose text must be reproduced in full rather than named.
 *
 * MPL-2.0 and Apache-2.0 both say so explicitly. MIT and BSD require the
 * copyright notice, which is inside their text anyway, so they are included
 * too - the only ones summarised are the handful that ask for nothing.
 */
const NO_TEXT_NEEDED = new Set(["CC0-1.0", "Unlicense", "0BSD"]);

/**
 * Runs a tool and returns its stdout.
 *
 * Only cargo is called this way now, and a failure is fatal. The first version
 * of this file also shelled out to npm and swallowed the failure as an empty
 * dependency tree, which is how it shipped with 331 crates and **zero** npm
 * packages - React, Base UI, Zustand and TanStack all silently unattributed.
 * A tool that cannot run has not told us there is nothing to report.
 */
function run(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** The text of whatever licence files a package directory carries. */
function licenseTexts(directory) {
  if (!directory || !existsSync(directory)) {
    return [];
  }
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && LICENSE_FILE.test(entry.name)) {
      // Normalised to LF. `.gitattributes` commits this repo's files as LF, so
      // a licence text that happens to ship with CRLF would be written one way,
      // committed another, and regenerate differently on the next run - which
      // would fail the CI drift check on a clean checkout with nothing actually
      // stale. Also strips a UTF-8 BOM, for the same reason.
      const text = readFileSync(join(directory, entry.name), "utf8")
        .replace(/^﻿/, "")
        .replaceAll("\r\n", "\n")
        .trim();
      if (text.length > 0) {
        found.push(text);
      }
    }
  }
  return found;
}

function cargoPackages() {
  const meta = JSON.parse(
    run("cargo", [
      "metadata",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--format-version",
      "1",
      "--filter-platform",
      "x86_64-pc-windows-msvc",
    ]),
  );
  return meta.packages
    .filter((pkg) => pkg.name !== "apex")
    .map((pkg) => ({
      ecosystem: "crate",
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? "(unstated)",
      repository: pkg.repository ?? null,
      // `manifest_path` points at Cargo.toml inside the unpacked source, which
      // is where the crate's own LICENSE files live.
      texts: licenseTexts(join(pkg.manifest_path, "..")),
    }));
}

/**
 * The production npm dependencies, from `package-lock.json`.
 *
 * The lockfile rather than `npm ls --prod --all --json`, which is what this
 * did first. Calling npm from `execFileSync` is a cross-platform trap: on
 * Windows npm is `npm.cmd`, and since CVE-2024-27980 Node refuses to spawn a
 * `.cmd` without a shell, so the plain name throws ENOENT and the real name
 * throws EINVAL. The lockfile needs no subprocess at all, is the same on every
 * platform, records the dev/prod split exactly, and is already the file `npm
 * ci` installs from - so it is the more authoritative source in the first
 * place.
 *
 * Its keys are install paths, which handles nesting correctly: a transitive
 * copy at `node_modules/a/node_modules/b` is read from there rather than from
 * a hoisted `node_modules/b` that may be a different version.
 */
function npmPackages() {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

  return Object.entries(lock.packages ?? {})
    .filter(([path, entry]) => {
      // The root project is the empty key, and is not a third party.
      if (!path.startsWith("node_modules/")) {
        return false;
      }
      // `devOptional` means "reachable only through dev or optional", which is
      // not something that ships either.
      return entry.dev !== true && entry.devOptional !== true && Boolean(entry.version);
    })
    .map(([path, entry]) => {
      const directory = join(root, path);
      let manifest = {};
      try {
        manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      } catch {
        // Not installed in this checkout. The entry still counts - the lockfile
        // is what decides what ships - it just carries no licence text.
      }
      const license =
        entry.license ??
        (typeof manifest.license === "string"
          ? manifest.license
          : Array.isArray(manifest.licenses)
            ? manifest.licenses.map((one) => one.type ?? "?").join(" OR ")
            : "(unstated)");
      return {
        ecosystem: "npm",
        name: path.slice("node_modules/".length).replace(/.*\/node_modules\//, ""),
        version: entry.version,
        license,
        repository:
          typeof manifest.repository === "string"
            ? manifest.repository
            : (manifest.repository?.url ?? null),
        texts: licenseTexts(directory),
      };
    });
}

function render(packages) {
  const byLicense = new Map();
  for (const pkg of packages) {
    const list = byLicense.get(pkg.license) ?? [];
    list.push(pkg);
    byLicense.set(pkg.license, list);
  }

  const lines = [];
  lines.push("# Third-party notices");
  lines.push("");
  lines.push(
    "Apex is MIT licensed; see [LICENSE](LICENSE). It is built from the",
    "open-source packages below, which carry their own terms.",
    "",
    "**This file is generated.** Run `npm run notices` to rebuild it; CI fails if",
    "it is out of date. Do not edit it by hand.",
    "",
  );
  lines.push("## Licences in use", "");
  lines.push("| Licence | Packages |", "| --- | --- |");
  for (const license of [...byLicense.keys()].sort()) {
    lines.push(`| ${license} | ${byLicense.get(license).length} |`);
  }
  lines.push("");

  const mpl = packages.filter((pkg) => pkg.license?.includes("MPL-2.0"));
  if (mpl.length > 0) {
    lines.push("## Mozilla Public License 2.0 — source availability", "");
    lines.push(
      "The packages below are covered by the MPL-2.0, which requires that anyone",
      "receiving this software be told where to obtain the source of those files.",
      "They are used unmodified, at the versions listed, and their source is",
      "available from the upstream repositories named in each entry — and, for",
      "the Rust crates, from crates.io at the exact version given.",
      "",
    );
    for (const pkg of mpl.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- **${pkg.name} ${pkg.version}** — ${pkg.repository ?? "see crates.io"}`);
    }
    lines.push("");
  }

  // Each distinct licence text once, referenced by number.
  //
  // Written out per package, this file was 2.6 MB: the Apache-2.0 text is
  // ~11 kB and appears verbatim in about two hundred crates. Deduplicating
  // reproduces every text in full - which is what the licences require - while
  // making the result a document a person could actually open. Texts that
  // differ only in their copyright line are still distinct texts and are still
  // reproduced separately, so no attribution is collapsed away.
  const texts = new Map();
  for (const pkg of packages) {
    for (const text of pkg.texts) {
      if (!texts.has(text)) {
        texts.set(text, texts.size + 1);
      }
    }
  }

  lines.push("## Packages", "");
  const sorted = [...packages].sort(
    (a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name),
  );
  lines.push("| Package | Version | Licence | Text |", "| --- | --- | --- | --- |");
  for (const pkg of sorted) {
    const refs =
      NO_TEXT_NEEDED.has(pkg.license) || pkg.texts.length === 0
        ? "—"
        : pkg.texts
            .map((text) => `[${texts.get(text)}](#licence-text-${texts.get(text)})`)
            .join(", ");
    const source = pkg.repository ? `[${pkg.name}](${pkg.repository})` : pkg.name;
    lines.push(`| ${source} | ${pkg.version} | ${pkg.license} | ${refs} |`);
  }
  lines.push("");

  lines.push("## Licence texts", "");
  for (const [text, number] of texts) {
    lines.push(`### Licence text ${number}`, "", "```text", text, "```", "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

const crates = cargoPackages();
const npm = npmPackages();

// Neither ecosystem may be empty.
//
// This is the guard for the failure that already happened once: npm could not
// be executed, the error was read as "no dependencies", and the file shipped
// with every crate attributed and not one npm package. A wrong notices file is
// worse than none, because it looks thorough - so an implausible answer is a
// hard failure rather than a quiet one.
for (const [ecosystem, found] of [
  ["crate", crates],
  ["npm", npm],
]) {
  if (found.length === 0) {
    console.error(
      `Found no ${ecosystem} dependencies, which cannot be right. The tool that ` +
        "lists them probably failed without saying so; fix that rather than " +
        "committing a notices file that omits an entire ecosystem.",
    );
    process.exit(1);
  }
}

const packages = [...crates, ...npm];
const rendered = render(packages);

if (process.argv.includes("--check")) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
  if (current !== rendered) {
    console.error(
      "THIRD-PARTY-NOTICES.md is out of date - run 'npm run notices' and commit the result.",
    );
    process.exit(1);
  }
  console.log(`THIRD-PARTY-NOTICES.md is current (${packages.length} packages).`);
} else {
  writeFileSync(OUTPUT, rendered);
  console.log(`Wrote THIRD-PARTY-NOTICES.md for ${packages.length} packages.`);
}
