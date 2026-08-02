import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Tauri gates every built-in API behind a capability file. A call that has no
 * matching permission compiles, typechecks, passes every mocked test, and then
 * fails at runtime with "not allowed by ACL" - which is exactly how both
 * `dialog.save` and the window geometry restore reached a real build broken.
 *
 * Nothing in the mocked test suite can catch that, because the mocks answer
 * whether or not the permission exists. So this checks the one thing the mocks
 * cannot: that each API the source actually calls is listed in the capability.
 *
 * It is a lookup table, not an analysis - a call it does not know about slips
 * through. Add a row when you reach for a new Tauri API.
 */
const REQUIRED: ReadonlyArray<{ call: RegExp; permission: string }> = [
  { call: /\bsave\s*\(/, permission: "dialog:allow-save" },
  { call: /\bopen\s*\(/, permission: "dialog:allow-open" },
  { call: /\.setPosition\s*\(/, permission: "core:window:allow-set-position" },
  { call: /\.setSize\s*\(/, permission: "core:window:allow-set-size" },
  { call: /\.minimize\s*\(/, permission: "core:window:allow-minimize" },
  { call: /\.toggleMaximize\s*\(/, permission: "core:window:allow-toggle-maximize" },
  { call: /\.close\s*\(/, permission: "core:window:allow-close" },
  { call: /\.startDragging\s*\(/, permission: "core:window:allow-start-dragging" },
];

/** Vitest runs from the repo root, and the capability file is addressed from there. */
const root = `${process.cwd().replaceAll("\\", "/")}/`;

const granted: string[] = JSON.parse(
  readFileSync(`${root}/src-tauri/capabilities/default.json`, "utf8"),
).permissions;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const sources = sourceFiles(`${root}src`).map((file) => ({
  file: file.slice(root.length),
  text: readFileSync(file, "utf8"),
}));

describe("Tauri capabilities", () => {
  it("finds source to check", () => {
    // Guards the guard: a glob that silently matched nothing would pass
    // every assertion below and prove nothing at all.
    expect(sources.length).toBeGreaterThan(20);
  });

  it.each(REQUIRED)("grants $permission to the code that needs it", ({ call, permission }) => {
    const callers = sources.filter(({ text }) => call.test(text)).map(({ file }) => file);

    if (callers.length === 0) {
      return;
    }

    expect(granted, `called in ${callers.join(", ")}`).toContain(permission);
  });
});
