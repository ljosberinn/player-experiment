import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `ci.yml`'s `changes` job decides whether the `e2e` job builds and drives the
 * app. Getting that wrong is silent: nothing fails, the gate just stops
 * checking something and still reports green.
 *
 * So the arms are exercised rather than read - and against the block the
 * workflow actually ships, sliced out of the file and run through `bash`. A
 * copy of the patterns here would be a second source that drifts.
 *
 * `bash` is on the `frontend` runner (ubuntu) and in the Git for Windows
 * toolchain every contributor already has, so its absence is a skip rather
 * than a failure.
 */
const root = `${process.cwd().replaceAll("\\", "/")}/`;
const workflow = readFileSync(`${root}.github/workflows/ci.yml`, "utf8");

const OPEN = 'case "$file" in';
const start = workflow.indexOf(OPEN);
const end = workflow.indexOf("esac", start);
const block = workflow.slice(start, end + "esac".length);

// The file list arrives on stdin rather than as an argument: Windows drops
// everything past the first newline in an argv entry, which made every
// multi-file case look like its first file alone.
const script = `
code=false
e2e=false
while IFS= read -r file; do
${block}
done
echo "$code/$e2e"
`;

let haveBash = true;
function classify(...files: string[]): string {
  return execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    input: `${files.join("\n")}\n`,
  }).trim();
}

try {
  classify("README.md");
} catch {
  haveBash = false;
}

describe("the changes job", () => {
  it("still has the case block this file tests", () => {
    // Slicing by string index rather than a parser: if the job is ever
    // restructured, fail here rather than silently testing an empty string.
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain(OPEN);
    expect(block.split("\n").length).toBeGreaterThan(5);
  });

  describe.skipIf(!haveBash)("classifies", () => {
    it.each([
      ["docs/issues/upcoming/125-ci.md"],
      ["docs/knowledge/ci-and-release.md"],
      ["README.md"],
      ["LICENSE"],
      [".githooks/pre-push"],
      ["src-tauri/README.md"],
    ])("%s as neither code nor app", (file) => {
      expect(classify(file)).toBe("false/false");
    });

    it.each([
      ["src/features/editor/store.test.ts"],
      ["src/components/charts/Bar.test.tsx"],
      ["src/components/ui/Button.stories.tsx"],
      ["src/test/setup.ts"],
      ["e2e/viewport.unit.test.ts"],
      [".storybook/preview.css"],
      [".vscode/extensions.json"],
      ["deny.toml"],
      [".release-please-manifest.json"],
      ["release-please-config.json"],
    ])("%s as code the app does not contain", (file) => {
      expect(classify(file)).toBe("true/false");
    });

    it.each([
      [".github/workflows/ci.yml"],
      ["src/features/library/LibraryTable.tsx"],
      ["src/styles/tokens.css"],
      ["src/ipc/bindings/Track.ts"],
      ["src-tauri/src/db/stats.rs"],
      ["src-tauri/Cargo.toml"],
      ["src-tauri/Cargo.lock"],
      ["src-tauri/tauri.conf.json"],
      ["src-tauri/capabilities/default.json"],
      [".cargo/config.toml"],
      ["package.json"],
      ["package-lock.json"],
      // `beforeBuildCommand` is `npm run notices && npm run build`, so the e2e
      // build runs the generator too; `screenshots.mjs` is an e2e step.
      ["scripts/notices.mjs"],
      ["scripts/screenshots.mjs"],
      ["e2e/specs/transport.test.ts"],
      ["e2e/wdio.conf.ts"],
      ["vite.config.ts"],
      ["biome.json"],
      ["tsconfig.json"],
      ["index.html"],
      // Nothing recognises it, so it counts as both. That is the fail-safe
      // direction and the reason a new root file needs no arm to be correct.
      [".gitattributes"],
    ])("%s as reaching the app", (file) => {
      expect(classify(file)).toBe("true/true");
    });

    it("lets one source file drag a documentation changeset up", () => {
      expect(classify("docs/issues/upcoming/125-ci.md", "src/App.tsx")).toBe("true/true");
    });

    it("keeps the app out of it when only a test joins the prose", () => {
      expect(classify("README.md", "src/App.test.tsx")).toBe("true/false");
    });
  });
});
