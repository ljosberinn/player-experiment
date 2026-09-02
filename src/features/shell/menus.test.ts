import { describe, expect, it, vi } from "vitest";
import type { MenuItem } from "../../components/ui/ContextMenu";
import { exportSelectionLabel, menus } from "./menus";

const noop = () => {};

/** A menu bar with nothing selected, no missing files and nothing to undo. */
function build(overrides: Partial<Parameters<typeof menus>[0]> = {}) {
  return menus({
    selectionCount: 0,
    missingCount: 0,
    removedCount: 0,
    canUndoTags: false,
    hasExportTarget: false,
    exportSelectionLabel: "Export Selection…",
    lastfmConfigured: false,
    lastfmUsername: null,
    rowItems: [],
    onAddFolder: noop,
    onRescan: noop,
    onRemoveFromLibrary: noop,
    onRemoveMissing: noop,
    onForgetRemoved: noop,
    onUndoTags: noop,
    onSettings: noop,
    onExportAll: noop,
    onExportSelection: noop,
    onLastfmDisconnect: noop,
    onOpenRepository: noop,
    ...overrides,
  });
}

/** The labels of one menu, separators included as `---`. */
function labels(items: MenuItem[]): string[] {
  return items.map((item) => (item.kind === "separator" ? "---" : item.label));
}

function menu(name: string, overrides: Partial<Parameters<typeof menus>[0]> = {}) {
  const found = build(overrides).find((one) => one.label === name);
  if (found === undefined) {
    throw new Error(`no ${name} menu`);
  }
  return found;
}

describe("the menu bar", () => {
  it("has the five menus the design names, in order", () => {
    expect(build().map((one) => one.label)).toEqual(["File", "Edit", "Export", "Account", "Help"]);
  });

  describe("Account", () => {
    it("stays empty and unopenable in a build carrying no last.fm key", () => {
      // Every local build and every CI run. Shipped empty since phase 34 on
      // purpose: a bar that grows an entry moves every entry after it, for
      // someone who had learned where Help was.
      expect(menu("Account").disabled).toBe(true);
      expect(menu("Account").items).toEqual([]);
    });

    it("offers the way in when a build has a key but no account", () => {
      const account = menu("Account", { lastfmConfigured: true });

      expect(account.disabled).toBe(false);
      expect(labels(account.items)).toEqual(["Connect to last.fm…"]);
    });

    it("sends Connect to Settings rather than starting the trip from a menu", () => {
      // Connecting opens a browser, and the page saying what leaves the
      // machine has to be in front of the user before that happens. A menu
      // item has nowhere to put it.
      const onSettings = vi.fn();
      const account = menu("Account", { lastfmConfigured: true, onSettings });

      const item = account.items[0];
      if (item?.kind === "separator") {
        throw new Error("expected an item");
      }
      item?.onSelect?.();
      expect(onSettings).toHaveBeenCalled();
    });

    it("names the account and offers the one-click way out", () => {
      const account = menu("Account", {
        lastfmConfigured: true,
        lastfmUsername: "listener",
      });

      expect(labels(account.items)).toEqual([
        "last.fm: listener",
        "---",
        "Disconnect from last.fm",
      ]);
      // The name is a fact, not an action.
      const name = account.items[0];
      expect(name?.kind !== "separator" && name?.disabled).toBe(true);
    });
  });

  describe("File", () => {
    it("offers only adding and rescanning while nothing is missing", () => {
      expect(labels(menu("File").items)).toEqual(["Add Folders…", "Rescan"]);
    });

    it("offers to remove missing songs only when some are", () => {
      // A permanent entry for a condition that in a library whose drives are
      // all plugged in never holds is one more thing to read past.
      expect(labels(menu("File", { missingCount: 3 }).items)).toEqual([
        "Add Folders…",
        "Rescan",
        "---",
        "Remove 3 Missing Songs…",
      ]);
    });

    it("counts one missing song in the singular", () => {
      expect(labels(menu("File", { missingCount: 1 }).items)).toContain("Remove 1 Missing Song…");
    });

    it("offers to remove the selection from the library, counting it", () => {
      // Here rather than in Edit with the other song actions: the user wants
      // it beside the other two row-destroying entries, and the three read as
      // one group.
      expect(labels(menu("File", { selectionCount: 3 }).items)).toEqual([
        "Add Folders…",
        "Rescan",
        "---",
        "Remove 3 Songs from Library…",
      ]);
      expect(labels(menu("File", { selectionCount: 1 }).items)).toContain(
        "Remove 1 Song from Library…",
      );
    });

    it("offers to forget the removals only once there are some", () => {
      expect(labels(menu("File").items)).not.toContain("Forget 0 Removed Songs…");
      expect(labels(menu("File", { removedCount: 2 }).items)).toContain("Forget 2 Removed Songs…");
      expect(labels(menu("File", { removedCount: 1 }).items)).toContain("Forget 1 Removed Song…");
    });

    it("groups all three behind one separator", () => {
      // Three conditions, each independent, and a separator per entry would
      // put three rules through a menu of five things.
      expect(
        labels(menu("File", { selectionCount: 2, missingCount: 1, removedCount: 4 }).items),
      ).toEqual([
        "Add Folders…",
        "Rescan",
        "---",
        "Remove 2 Songs from Library…",
        "Remove 1 Missing Song…",
        "Forget 4 Removed Songs…",
      ]);
    });
  });

  describe("Edit", () => {
    it("carries the song actions when there is a selection", () => {
      // The items themselves come from `rowMenuItems`, so this only asserts
      // that they arrive - what they contain is that module's own test.
      const rowItems: MenuItem[] = [{ label: "Play" }, { label: "Edit 2 Songs" }];

      expect(labels(menu("Edit", { rowItems }).items)).toEqual([
        "Play",
        "Edit 2 Songs",
        "---",
        "Undo Tag Edit",
        "---",
        "Settings…",
      ]);
    });

    it("is Undo and Settings alone when nothing is selected", () => {
      // And no leading separator: a menu that opens with a rule looks broken.
      expect(labels(menu("Edit").items)).toEqual(["Undo Tag Edit", "---", "Settings…"]);
    });

    it("disables Undo until there is an edit to undo", () => {
      const undoItem = (canUndoTags: boolean) =>
        menu("Edit", { canUndoTags }).items.find(
          (item) => item.kind !== "separator" && item.label === "Undo Tag Edit",
        );

      expect(undoItem(false)).toMatchObject({ disabled: true });
      expect(undoItem(true)).toMatchObject({ disabled: false });
    });
  });

  describe("Export", () => {
    it("always offers the whole library", () => {
      const all = menu("Export").items[0];
      if (all?.kind === "separator" || all === undefined) {
        throw new Error("Export All is missing");
      }
      expect(all.label).toBe("Export All…");
      // Never conditional: there is always a library, even an empty one.
      expect(all.disabled).toBeFalsy();
    });

    it("disables the narrower export when there is nothing to narrow to", () => {
      expect(menu("Export").items[1]).toMatchObject({ disabled: true });
      expect(menu("Export", { hasExportTarget: true }).items[1]).toMatchObject({ disabled: false });
    });

    it("says what it is about to export", () => {
      expect(menu("Export", { exportSelectionLabel: "Export 4 Songs…" }).items[1]).toMatchObject({
        label: "Export 4 Songs…",
      });
    });
  });

  it("runs the handler it was given", () => {
    const onRescan = vi.fn();
    const rescan = menu("File", { onRescan }).items[1];

    if (rescan?.kind === "separator") {
      throw new Error("Rescan is not a separator");
    }
    rescan?.onSelect?.();

    expect(onRescan).toHaveBeenCalled();
  });
});

describe("what Export Selection calls itself", () => {
  it("counts the selection when there is one", () => {
    expect(exportSelectionLabel(1, null)).toBe("Export 1 Song…");
    expect(exportSelectionLabel(4, null)).toBe("Export 4 Songs…");
  });

  it("names the open playlist when nothing inside it is picked out", () => {
    // The case this function exists for: with a playlist open and no row
    // selected, "the selection" means the playlist.
    expect(exportSelectionLabel(0, "Evening")).toBe("Export “Evening”…");
  });

  it("prefers the selection to the playlist it sits in", () => {
    expect(exportSelectionLabel(2, "Evening")).toBe("Export 2 Songs…");
  });

  it("stays generic with nothing to export", () => {
    expect(exportSelectionLabel(0, null)).toBe("Export Selection…");
  });
});
