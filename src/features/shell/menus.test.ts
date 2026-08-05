import { describe, expect, it, vi } from "vitest";
import type { MenuItem } from "../../components/ui/ContextMenu";
import { exportSelectionLabel, menus } from "./menus";

const noop = () => {};

/** A menu bar with nothing selected, no missing files and nothing to undo. */
function build(overrides: Partial<Parameters<typeof menus>[0]> = {}) {
  return menus({
    missingCount: 0,
    canUndoTags: false,
    hasExportTarget: false,
    exportSelectionLabel: "Export Selection…",
    rowItems: [],
    onAddFolder: noop,
    onRescan: noop,
    onRemoveMissing: noop,
    onUndoTags: noop,
    onSettings: noop,
    onExportAll: noop,
    onExportSelection: noop,
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

  it("shows Account empty and unopenable until there is an account", () => {
    // Shipped now rather than added later on purpose: a bar that grows an entry
    // moves every entry after it, for someone who had learned where Help was.
    expect(menu("Account").disabled).toBe(true);
    expect(menu("Account").items).toEqual([]);
  });

  describe("File", () => {
    it("offers only adding and rescanning while nothing is missing", () => {
      expect(labels(menu("File").items)).toEqual(["Add Folder…", "Rescan"]);
    });

    it("offers to remove missing songs only when some are", () => {
      // A permanent entry for a condition that in a library whose drives are
      // all plugged in never holds is one more thing to read past.
      expect(labels(menu("File", { missingCount: 3 }).items)).toEqual([
        "Add Folder…",
        "Rescan",
        "---",
        "Remove 3 Missing Songs…",
      ]);
    });

    it("counts one missing song in the singular", () => {
      expect(labels(menu("File", { missingCount: 1 }).items)).toContain("Remove 1 Missing Song…");
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
