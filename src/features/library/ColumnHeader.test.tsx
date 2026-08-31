import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ColumnHeader } from "./ColumnHeader";
import { DRAG_THRESHOLD_PX } from "./columnDrag";
import { ALL_COLUMNS, resolveColumns } from "./columns";
import { useLibraryStore } from "./store";

vi.mock("../../ipc", () => ({
  countTracks: vi.fn(),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0 })),
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
  browseGroups: vi.fn(async () => []),
  loadColumnConfig: vi.fn(async () => null),
  saveColumnConfig: vi.fn(async () => undefined),
}));

const initial = useLibraryStore.getState();

/** Renders the header inside the table markup it belongs to. */
function renderHeader(ids: Parameters<typeof resolveColumns>[0]["ids"], onSort = vi.fn()) {
  const config = { ids, widths: {} };
  useLibraryStore.setState({ columns: config });
  const result = render(
    <table>
      <thead>
        <ColumnHeader
          columns={resolveColumns(config)}
          sortBy="title"
          direction="asc"
          onSort={onSort}
        />
      </thead>
    </table>,
  );
  return { ...result, onSort };
}

beforeEach(() => {
  vi.restoreAllMocks();
  useLibraryStore.setState({ ...initial });
});

describe("sorting versus dragging a header", () => {
  it("sorts on a click that did not travel", async () => {
    const user = userEvent.setup();
    const { onSort } = renderHeader(["title", "artist"]);

    await user.click(screen.getByRole("button", { name: /Artist/ }));

    expect(onSort).toHaveBeenCalledWith("artist");
  });

  it("reorders on a drag, and does not also sort", () => {
    const moveColumn = vi.fn(async () => undefined);
    useLibraryStore.setState({ moveColumn });
    const { onSort } = renderHeader(["title", "artist", "album"]);
    const header = screen.getByRole("button", { name: /Title|Name/ });

    fireEvent.pointerDown(header, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(header, { clientX: DRAG_THRESHOLD_PX + 50, pointerId: 1 });
    fireEvent.pointerUp(header, { clientX: DRAG_THRESHOLD_PX + 50, pointerId: 1 });
    fireEvent.click(header);

    expect(moveColumn).toHaveBeenCalled();
    // pointerup fires before click, so without suppression every reorder would
    // also sort by whichever column was dropped on.
    expect(onSort).not.toHaveBeenCalled();
  });

  it("still sorts on the click after a press that stayed put", () => {
    const moveColumn = vi.fn(async () => undefined);
    useLibraryStore.setState({ moveColumn });
    const { onSort } = renderHeader(["title", "artist"]);
    const header = screen.getByRole("button", { name: /Artist/ });

    // Under the threshold: a click with a shaky hand is still a click.
    fireEvent.pointerDown(header, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(header, { clientX: 102, pointerId: 1 });
    fireEvent.pointerUp(header, { clientX: 102, pointerId: 1 });
    fireEvent.click(header);

    expect(moveColumn).not.toHaveBeenCalled();
    expect(onSort).toHaveBeenCalledWith("artist");
  });

  it("ignores a right-click press, which opens the menu instead", () => {
    const moveColumn = vi.fn(async () => undefined);
    useLibraryStore.setState({ moveColumn });
    renderHeader(["title", "artist"]);
    const header = screen.getByRole("button", { name: /Artist/ });

    fireEvent.pointerDown(header, { button: 2, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(header, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(header, { clientX: 200, pointerId: 1 });

    expect(moveColumn).not.toHaveBeenCalled();
  });
});

describe("resizing a column", () => {
  it("commits the dragged width once, on release", () => {
    const resizeColumn = vi.fn(async () => undefined);
    useLibraryStore.setState({ resizeColumn });
    renderHeader(["title", "artist"]);
    const grip = screen.getByTestId("resize-title");

    fireEvent.pointerDown(grip, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 150, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 180, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientX: 180, pointerId: 1 });

    // The expected width is the column's own default plus the 80px the
    // pointer travelled, rather than a literal: the point is that the drag
    // distance is added to where the column started, which a hardcoded number
    // stops testing the moment the density is rebased.
    const started = ALL_COLUMNS.find((c) => c.id === "title")?.width ?? 0;

    // Once, not once per pixel: a store write per move would persist a hundred
    // layouts across one drag.
    expect(resizeColumn).toHaveBeenCalledTimes(1);
    expect(resizeColumn).toHaveBeenCalledWith("title", started + 80);
  });

  it("fits the column to what is on screen when the divider is double-clicked", () => {
    // jsdom lays nothing out, so the measurement is stubbed: ten pixels a
    // character, which makes the expected answer arithmetic rather than magic.
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockImplementation(function (this: Range) {
      const text = this.startContainer.textContent ?? "";
      return { width: text.length * 10 } as DOMRect;
    });
    const resizeColumn = vi.fn(async () => undefined);
    useLibraryStore.setState({ resizeColumn });

    const config = { ids: ["title", "artist"] as const, widths: {} };
    useLibraryStore.setState({ columns: { ids: [...config.ids], widths: {} } });
    render(
      <table>
        <thead>
          <ColumnHeader
            columns={resolveColumns({ ids: [...config.ids], widths: {} })}
            sortBy="artist"
            direction="asc"
            onSort={vi.fn()}
          />
        </thead>
        <tbody>
          <tr>
            <td className="song-cell" data-column="title">
              short
            </td>
            <td className="song-cell" data-column="artist">
              ignored, it is another column
            </td>
          </tr>
          <tr>
            <td className="song-cell" data-column="title">
              the longest title on screen
            </td>
          </tr>
        </tbody>
      </table>,
    );

    fireEvent.doubleClick(screen.getByTestId("resize-title"));

    // 27 characters at ten pixels, plus the 24px of padding a cell carries.
    // The header, "Title", is narrower and does not decide it.
    expect(resizeColumn).toHaveBeenCalledWith(
      "title",
      "the longest title on screen".length * 10 + 24,
    );
  });

  it("does not start a reorder as well", () => {
    const moveColumn = vi.fn(async () => undefined);
    const resizeColumn = vi.fn(async () => undefined);
    useLibraryStore.setState({ moveColumn, resizeColumn });
    renderHeader(["title", "artist"]);
    const grip = screen.getByTestId("resize-title");

    fireEvent.pointerDown(grip, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientX: 200, pointerId: 1 });

    // Otherwise the header travels with the divider.
    expect(moveColumn).not.toHaveBeenCalled();
    expect(resizeColumn).toHaveBeenCalled();
  });
});

describe("the column menu", () => {
  async function openMenu() {
    const user = userEvent.setup();
    fireEvent.contextMenu(screen.getAllByRole("columnheader")[0] as HTMLElement, {
      clientX: 10,
      clientY: 10,
    });
    return user;
  }

  it("lists every column, marking the ones on screen", async () => {
    renderHeader(["title", "artist"]);
    await openMenu();

    expect(screen.getByRole("menuitem", { name: /✓\s*Name/ })).toBeInTheDocument();
    // Present but unmarked, so it can be switched on.
    expect(screen.getByRole("menuitem", { name: /Location/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /✓\s*Location/ })).not.toBeInTheDocument();
  });

  it("toggles a column from the menu", async () => {
    const toggleColumn = vi.fn(async () => undefined);
    useLibraryStore.setState({ toggleColumn });
    renderHeader(["title", "artist"]);
    const user = await openMenu();

    await user.click(screen.getByRole("menuitem", { name: /Location/ }));

    expect(toggleColumn).toHaveBeenCalledWith("path");
  });

  it("refuses to hide the only column left", async () => {
    renderHeader(["title"]);
    await openMenu();

    // Disabled rather than failing silently when picked - an empty table has
    // no headers, so no menu, so no way back.
    //
    // `aria-disabled`, not `toBeDisabled`: a menu item is a div with a role,
    // not a <button disabled>, and jest-dom's matcher only reads the native
    // attribute. This is the one screen readers announce anyway.
    expect(screen.getByRole("menuitem", { name: /✓\s*Name/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("offers a way back to the defaults", async () => {
    const resetColumns = vi.fn(async () => undefined);
    useLibraryStore.setState({ resetColumns });
    renderHeader(["path"]);
    const user = await openMenu();

    await user.click(screen.getByRole("menuitem", { name: "Reset Columns" }));

    // Someone who hid five columns needs a way back that is not "guess which".
    expect(resetColumns).toHaveBeenCalled();
  });
});
