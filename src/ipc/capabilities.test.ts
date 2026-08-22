import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { albumLinks, artistLinks } from "../features/library/externalLinks";
import { REPOSITORY } from "../features/shell/menus";

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
  { call: /\.show\s*\(/, permission: "core:window:allow-show" },
  { call: /\.maximize\s*\(/, permission: "core:window:allow-maximize" },
  { call: /\.setPosition\s*\(/, permission: "core:window:allow-set-position" },
  { call: /\.setSize\s*\(/, permission: "core:window:allow-set-size" },
  { call: /\.minimize\s*\(/, permission: "core:window:allow-minimize" },
  { call: /\.toggleMaximize\s*\(/, permission: "core:window:allow-toggle-maximize" },
  { call: /\.close\s*\(/, permission: "core:window:allow-close" },
  { call: /\.startDragging\s*\(/, permission: "core:window:allow-start-dragging" },
  // The plugin's own `default` set is deliberately empty - it grants nothing,
  // because the authors consider a global shortcut dangerous enough to be
  // opted into one at a time. So `global-shortcut:default` would look like a
  // grant and be none, which is exactly the failure this table exists for.
  // `unregister` is listed first, and `register` is anchored on `await `: the
  // two names overlap, so a bare /register\(/ also matches every
  // `unregister(` and each row would report the other's callers.
  { call: /\bunregister\s*\(/, permission: "global-shortcut:allow-unregister" },
  { call: /await register\s*\(/, permission: "global-shortcut:allow-register" },
  { call: /\.setZoom\s*\(/, permission: "core:webview:allow-set-webview-zoom" },
  { call: /\bopenUrl\s*\(/, permission: "opener:allow-open-url" },
  // Matched on the import rather than the call: the updater's methods are
  // `check`, `download` and `install`, all words this codebase uses for its
  // own things, so a call-shaped pattern would match everywhere or nowhere.
  { call: /@tauri-apps\/plugin-updater/, permission: "updater:default" },
];

/** Vitest runs from the repo root, and the capability file is addressed from there. */
const root = `${process.cwd().replaceAll("\\", "/")}/`;

/** One permission: a bare identifier, or an identifier plus the scope it needs. */
type Permission = string | { identifier: string; allow: { url: string }[] };

/**
 * `opener:allow-open-url` carries an allowlist, so it arrives as an object
 * rather than a string - and `toContain` against the raw array would never
 * match it, which is the vacuous pass this file has already been bitten by.
 */
const permissions: Permission[] = JSON.parse(
  readFileSync(`${root}/src-tauri/capabilities/default.json`, "utf8"),
).permissions;

const granted: string[] = permissions.map((permission) =>
  typeof permission === "string" ? permission : permission.identifier,
);

/** The URL patterns the opener is scoped to. */
const openerScope: string[] = permissions.flatMap((permission) =>
  typeof permission === "string" || permission.identifier !== "opener:allow-open-url"
    ? []
    : permission.allow.map((entry) => entry.url),
);

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

  it("scopes the opener to the three places the app may send the user", () => {
    // An allowlist, and the whole of it: a fourth host appearing here without
    // a feature behind it is what this asserts against.
    expect(openerScope).toEqual([
      "https://github.com/ljosberinn/*",
      "https://www.last.fm/*",
      "https://www.discogs.com/*",
    ]);
  });

  it("covers every URL the app can build", () => {
    // The scope is matched by `glob::Pattern` inside the plugin, where `*`
    // crosses `/` - so a host pattern covers every path under it. Compared as
    // a prefix rather than by reimplementing the glob: what drifts is a host
    // added in TypeScript and forgotten in the capability, and that fails here.
    const built = [
      REPOSITORY,
      ...artistLinks("Blue Room").map((link) => link.url),
      ...albumLinks("Blue Room", "Harbour").map((link) => link.url),
    ];
    const prefixes = openerScope.map((pattern) => pattern.replace(/\*$/, ""));

    for (const url of built) {
      expect(
        prefixes.some((prefix) => url.startsWith(prefix)),
        url,
      ).toBe(true);
    }
  });

  it.each(REQUIRED)("grants $permission to the code that needs it", ({ call, permission }) => {
    const callers = sources.filter(({ text }) => call.test(text)).map(({ file }) => file);

    if (callers.length === 0) {
      return;
    }

    expect(granted, `called in ${callers.join(", ")}`).toContain(permission);
  });
});
