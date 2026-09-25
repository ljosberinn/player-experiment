import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../../components/primitives/Dialog";
import { SearchBox } from "./SearchBox";
import { useLibraryStore } from "./store";

vi.mock("../../ipc", () => ({
  countTracks: vi.fn(async () => 0),
  queryTracks: vi.fn(async () => []),
  listPlaylists: vi.fn(async () => []),
}));

const initial = useLibraryStore.getState();

beforeEach(() => {
  useLibraryStore.setState({ ...initial, playlistId: null, searchInput: "grizzly" });
});

function field(): HTMLInputElement {
  return screen.getByRole("searchbox", { name: "Search Library" });
}

/** Whether the chord got through to the webview, which is where the find bar lives. */
function press(target: Element, init: KeyboardEventInit): boolean {
  return fireEvent.keyDown(target, init);
}

describe("SearchBox's Ctrl+F", () => {
  it("focuses the field with its text selected, and keeps the find bar shut", () => {
    render(<SearchBox />);

    const passed = press(document.body, { key: "f", ctrlKey: true });

    expect(passed).toBe(false);
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, "grizzly".length]);
  });

  it("also answers to Cmd+F", () => {
    render(<SearchBox />);

    press(document.body, { key: "f", metaKey: true });

    expect(document.activeElement).toBe(field());
  });

  it("selects the text again from inside the field", () => {
    render(<SearchBox />);
    field().focus();
    field().setSelectionRange(3, 3);

    const passed = press(field(), { key: "f", ctrlKey: true });

    expect(passed).toBe(false);
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, "grizzly".length]);
  });

  it("leaves Ctrl+Shift+F and a bare F alone", () => {
    render(<SearchBox />);

    expect(press(document.body, { key: "F", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(press(document.body, { key: "f" })).toBe(true);
    expect(document.activeElement).not.toBe(field());
  });

  it("does not reach past an open dialog, and still keeps the find bar shut", () => {
    render(
      <>
        <SearchBox />
        <Dialog onClose={() => undefined}>
          <button type="button">Inside</button>
        </Dialog>
      </>,
    );
    const inside = screen.getByRole("button", { name: "Inside" });
    inside.focus();

    const passed = press(inside, { key: "f", ctrlKey: true });

    expect(passed).toBe(false);
    expect(document.activeElement).toBe(inside);
  });
});
