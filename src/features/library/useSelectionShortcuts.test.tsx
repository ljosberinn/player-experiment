import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { allTrackIds } from "../../ipc";
import { useLibraryStore } from "./store";
import { useSelectionShortcuts } from "./useSelectionShortcuts";

vi.mock("../../ipc", () => ({
  allTrackIds: vi.fn(),
  countTracks: vi.fn(async () => 0),
  queryTracks: vi.fn(async () => []),
}));

function Harness() {
  useSelectionShortcuts();
  return <input aria-label="Search" />;
}

const initial = useLibraryStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({
    ...initial,
    selection: { ids: new Set(), anchorIndex: null },
    playlistId: null,
    search: "",
  });
  vi.mocked(allTrackIds).mockResolvedValue([1, 2, 3]);
});

describe("useSelectionShortcuts", () => {
  it("selects everything the query matches on Ctrl+A", async () => {
    render(<Harness />);
    const user = userEvent.setup();

    await user.keyboard("{Control>}a{/Control}");

    // Every matching id, not just the loaded pages - a selection truncated at
    // what happened to be scrolled into view would be a trap.
    expect(allTrackIds).toHaveBeenCalled();
    expect([...useLibraryStore.getState().selection.ids]).toEqual([1, 2, 3]);
  });

  it("also answers to Cmd+A", async () => {
    render(<Harness />);
    const user = userEvent.setup();

    await user.keyboard("{Meta>}a{/Meta}");

    expect(allTrackIds).toHaveBeenCalled();
  });

  it("respects the current filter rather than selecting the whole library", async () => {
    useLibraryStore.setState({ search: "grizzly", playlistId: 4 });
    render(<Harness />);
    const user = userEvent.setup();

    await user.keyboard("{Control>}a{/Control}");

    expect(allTrackIds).toHaveBeenCalledWith(
      expect.objectContaining({ search: "grizzly", playlistId: 4 }),
    );
  });

  it("leaves Ctrl+A alone while the user is typing", async () => {
    render(<Harness />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("textbox", { name: "Search" }));
    await user.keyboard("{Control>}a{/Control}");

    // In a text field Ctrl+A means "select this text", which is far more
    // useful than selecting the library behind it.
    expect(allTrackIds).not.toHaveBeenCalled();
  });

  it("clears the selection on Escape", async () => {
    useLibraryStore.setState({ selection: { ids: new Set([1, 2]), anchorIndex: 0 } });
    render(<Harness />);
    const user = userEvent.setup();

    await user.keyboard("{Escape}");

    expect(useLibraryStore.getState().selection.ids.size).toBe(0);
  });

  it("leaves a bare Escape alone when nothing is selected", async () => {
    render(<Harness />);
    const user = userEvent.setup();

    // Escape belongs to whatever else wants it - a dialog, the search box -
    // when there is no selection for it to clear.
    const onWindowKeyDown = vi.fn((event: KeyboardEvent) => {
      expect(event.defaultPrevented).toBe(false);
    });
    window.addEventListener("keydown", onWindowKeyDown);
    await user.keyboard("{Escape}");
    window.removeEventListener("keydown", onWindowKeyDown);

    expect(onWindowKeyDown).toHaveBeenCalled();
  });
});
