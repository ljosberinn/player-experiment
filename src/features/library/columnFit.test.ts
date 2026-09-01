import { beforeEach, describe, expect, it, vi } from "vitest";
import { CELL_PADDING_PX } from "./columnDrag";
import { measureColumns, measuredWidth } from "./columnFit";
import { MIN_COLUMN_WIDTH } from "./columns";

/**
 * jsdom lays nothing out, so the measurement is stubbed: ten pixels a
 * character, which makes every expected answer arithmetic rather than magic.
 * The same stub `ColumnHeader.test.tsx` installs for the double-click.
 */
function stubTextWidth() {
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockImplementation(function (this: Range) {
    const text = this.startContainer.textContent ?? "";
    return { width: text.length * 10 } as DOMRect;
  });
}

/** A header row and a body, as the real table renders them. */
function table(headers: Record<string, string>, rows: Record<string, string>[]): HTMLTableElement {
  const element = document.createElement("table");
  element.innerHTML = `
    <thead>
      <tr>
        ${Object.entries(headers)
          .map(
            ([id, label]) =>
              `<th data-column="${id}"><button class="song-header-cell">${label}</button></th>`,
          )
          .join("")}
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (row) =>
            `<tr>${Object.entries(row)
              .map(([id, value]) => `<td class="song-cell" data-column="${id}">${value}</td>`)
              .join("")}</tr>`,
        )
        .join("")}
    </tbody>`;
  return element;
}

beforeEach(() => {
  vi.restoreAllMocks();
  stubTextWidth();
});

describe("measuring one column", () => {
  it("takes the widest cell on screen, plus the padding it carries", () => {
    const element = table({ title: "Name" }, [{ title: "short" }, { title: "the longest title" }]);

    expect(measuredWidth(element, "title")).toBe("the longest title".length * 10 + CELL_PADDING_PX);
  });

  it("counts the header, which can be the widest thing in a column", () => {
    const element = table({ albumArtist: "Album Artist" }, [{ albumArtist: "V/A" }]);

    expect(measuredWidth(element, "albumArtist")).toBe(
      "Album Artist".length * 10 + CELL_PADDING_PX,
    );
  });

  it("ignores the other columns' cells", () => {
    const element = table({ title: "Name", artist: "Artist" }, [
      { title: "short", artist: "a very much longer artist name" },
    ]);

    expect(measuredWidth(element, "title")).toBe("short".length * 10 + CELL_PADDING_PX);
  });

  it("never goes below the width a column can be grabbed at", () => {
    const element = table({ trackNo: "" }, [{ trackNo: "" }]);

    expect(measuredWidth(element, "trackNo")).toBe(MIN_COLUMN_WIDTH);
  });
});

describe("measuring every visible column at once", () => {
  it("returns one width per column asked for", () => {
    const element = table({ title: "Name", artist: "Artist" }, [
      { title: "Anchor", artist: "Blue Room" },
    ]);

    expect(measureColumns(element, ["title", "artist"])).toEqual({
      title: "Anchor".length * 10 + CELL_PADDING_PX,
      artist: "Blue Room".length * 10 + CELL_PADDING_PX,
    });
  });

  it("leaves out a column with nothing in the table to measure", () => {
    const element = table({ title: "Name" }, [{ title: "Anchor" }]);

    // A width invented for a column that is not rendered would be applied the
    // moment it was switched on, from a measurement of nothing.
    expect(measureColumns(element, ["title", "genre"])).toEqual({
      title: "Anchor".length * 10 + CELL_PADDING_PX,
    });
  });
});
