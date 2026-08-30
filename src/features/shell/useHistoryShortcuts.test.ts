import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLibraryStore } from "../library/store";
import { historyButtonFor, historyShortcutFor, useHistoryShortcuts } from "./useHistoryShortcuts";

vi.mock("../../ipc", () => ({
  countTracks: vi.fn(),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0 })),
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
  browseGroups: vi.fn(async () => []),
  loadColumnConfig: vi.fn(async () => null),
  saveColumnConfig: vi.fn(async () => undefined),
}));

describe("historyShortcutFor", () => {
  it("maps Alt with the horizontal arrows", () => {
    expect(historyShortcutFor({ key: "ArrowLeft", altKey: true })).toBe("back");
    expect(historyShortcutFor({ key: "ArrowRight", altKey: true })).toBe("forward");
  });

  it("leaves the bare arrows to the player, which seeks with them", () => {
    expect(historyShortcutFor({ key: "ArrowLeft" })).toBeNull();
    expect(historyShortcutFor({ key: "ArrowRight" })).toBeNull();
  });

  it("ignores the vertical arrows, which are volume", () => {
    expect(historyShortcutFor({ key: "ArrowUp", altKey: true })).toBeNull();
    expect(historyShortcutFor({ key: "ArrowDown", altKey: true })).toBeNull();
  });

  it("refuses any other modifier alongside Alt", () => {
    // Ctrl+Alt+← and Shift+Alt+← mean nothing here and something in a text
    // field; treating them as back would swallow both.
    expect(historyShortcutFor({ key: "ArrowLeft", altKey: true, ctrlKey: true })).toBeNull();
    expect(historyShortcutFor({ key: "ArrowLeft", altKey: true, shiftKey: true })).toBeNull();
    expect(historyShortcutFor({ key: "ArrowLeft", altKey: true, metaKey: true })).toBeNull();
  });
});

describe("historyButtonFor", () => {
  it("maps the two side buttons", () => {
    expect(historyButtonFor({ button: 3 })).toBe("back");
    expect(historyButtonFor({ button: 4 })).toBe("forward");
  });

  it("leaves the buttons that already mean something alone", () => {
    // 0 selects a row, 2 opens the row menu, 1 is the middle button and has no
    // meaning here - navigating on any of them would be a trap.
    expect(historyButtonFor({ button: 0 })).toBeNull();
    expect(historyButtonFor({ button: 1 })).toBeNull();
    expect(historyButtonFor({ button: 2 })).toBeNull();
  });
});

describe("the bindings themselves", () => {
  let unmount = () => {};

  beforeEach(() => {
    useLibraryStore.setState({ back: vi.fn(async () => {}), forward: vi.fn(async () => {}) });
    unmount = renderHook(() => useHistoryShortcuts()).unmount;
  });

  afterEach(() => {
    unmount();
    document.body.replaceChildren();
  });

  /** A focused text field, which is what the two rules below hinge on. */
  function typingIn(): HTMLInputElement {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    return input;
  }

  function keyDown(target: EventTarget, key: string): void {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, altKey: true, bubbles: true }));
  }

  it("binds Alt+arrows window-wide", () => {
    keyDown(document.body, "ArrowLeft");
    expect(useLibraryStore.getState().back).toHaveBeenCalled();

    keyDown(document.body, "ArrowRight");
    expect(useLibraryStore.getState().forward).toHaveBeenCalled();
  });

  it("leaves Alt+arrows to a field being typed in", () => {
    keyDown(typingIn(), "ArrowLeft");

    expect(useLibraryStore.getState().back).not.toHaveBeenCalled();
  });

  it("navigates on a side button pressed inside the search box", () => {
    typingIn().dispatchEvent(new MouseEvent("pointerdown", { button: 3, bubbles: true }));

    // A thumb on a mouse button is unambiguous in a way a hand on the keyboard
    // is not: nothing in a text field means "button 3".
    expect(useLibraryStore.getState().back).toHaveBeenCalled();
  });

  it("stops listening once it is unmounted", () => {
    unmount();
    unmount = () => {};

    keyDown(document.body, "ArrowLeft");

    expect(useLibraryStore.getState().back).not.toHaveBeenCalled();
  });
});
