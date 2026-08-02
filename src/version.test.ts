import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The version lives in three files, and release-please updates all three.
 *
 * `package.json` is the one it tracks; `tauri.conf.json` names the installer
 * and shows in Add/Remove Programs; `Cargo.toml` is what `CARGO_PKG_VERSION`
 * reports, which reaches the user through `get_app_info` and through the
 * `generator` block of every JSON export.
 *
 * If they drift, an export claims one version, the installed program claims
 * another, and the tag claims a third. That is the kind of thing nobody
 * notices until a bug report cites a version that never existed - so it is
 * checked rather than trusted to configuration staying correct.
 *
 * `Cargo.lock` also carries the version and is deliberately **not** checked:
 * cargo rewrites it during the next build, so it lags by design rather than
 * drifting, and asserting on it would fail every release for no benefit.
 */
const root = `${process.cwd().replaceAll("\\", "/")}/`;

function read(path: string): string {
  return readFileSync(`${root}${path}`, "utf8");
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

describe("the version", () => {
  const fromPackageJson: string = JSON.parse(read("package.json")).version;
  const fromTauriConf: string = JSON.parse(read("src-tauri/tauri.conf.json")).version;
  // The first `version = "x"` in Cargo.toml is the package's own; every later
  // one belongs to a dependency.
  const fromCargoToml = /^version\s*=\s*"([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1];

  it("is a semantic version", () => {
    expect(fromPackageJson).toMatch(SEMVER);
  });

  it("says the same thing in package.json, tauri.conf.json and Cargo.toml", () => {
    expect({ tauri: fromTauriConf, cargo: fromCargoToml }).toEqual({
      tauri: fromPackageJson,
      cargo: fromPackageJson,
    });
  });

  it("is listed in the release-please manifest", () => {
    const manifest: Record<string, string> = JSON.parse(read(".release-please-manifest.json"));

    // The manifest is what release-please bumps from. If it disagrees with
    // package.json the next release jumps or repeats a version.
    expect(manifest["."]).toBe(fromPackageJson);
  });

  it("has release-please updating every file that carries it", () => {
    const config = JSON.parse(read("release-please-config.json"));
    const paths: string[] = (config.packages["."].extraFiles ?? config.packages["."]["extra-files"])
      .map((entry: string | { path: string }) => (typeof entry === "string" ? entry : entry.path))
      .sort();

    // package.json is implicit for the node release type; the other two have
    // to be declared, and forgetting one is exactly how they drift.
    expect(paths).toEqual(["src-tauri/Cargo.toml", "src-tauri/tauri.conf.json"]);
  });
});
