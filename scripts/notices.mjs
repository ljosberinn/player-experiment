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
 * npm: the production tree only (`npm ls --prod`). Dev dependencies are not
 * over-included the same way because the distinction is exact and the tree is
 * large - Vite, Biome, Vitest and WebdriverIO are build and test tooling whose
 * code never reaches the bundle.
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
    .filter((pkg) => pkg.name !== "player")
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

/** Flattens `npm ls --prod --all --json` into one entry per name@version. */
function npmPackages() {
  let tree;
  try {
    tree = JSON.parse(run("npm", ["ls", "--prod", "--all", "--json"]));
  } catch (error) {
    // `npm ls` exits non-zero on peer-dependency complaints while still
    // printing a complete tree, so the output matters more than the code.
    tree = JSON.parse(error.stdout ?? "{}");
  }

  const seen = new Map();
  const walk = (node) => {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      const key = `${name}@${child.version}`;
      if (!seen.has(key) && child.version) {
        const directory = join(root, "node_modules", name);
        let manifest = {};
        try {
          manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
        } catch {
          // A hoisted or deduped package that is not where its name suggests.
          // It still gets an entry, just without a licence text.
        }
        const license =
          typeof manifest.license === "string"
            ? manifest.license
            : Array.isArray(manifest.licenses)
              ? manifest.licenses.map((one) => one.type ?? "?").join(" OR ")
              : "(unstated)";
        seen.set(key, {
          ecosystem: "npm",
          name,
          version: child.version,
          license,
          repository:
            typeof manifest.repository === "string"
              ? manifest.repository
              : (manifest.repository?.url ?? null),
          texts: licenseTexts(directory),
        });
      }
      walk(child);
    }
  };
  walk(tree);
  return [...seen.values()];
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
    "Player is MIT licensed; see [LICENSE](LICENSE). It is built from the",
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

const packages = [...cargoPackages(), ...npmPackages()];
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
