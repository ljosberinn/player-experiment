import { describe, expect, it } from "vitest";
import { exportChoice, safeFileName } from "./scope";

describe("exportChoice", () => {
  it("exports the whole library when nothing narrows it", () => {
    const choice = exportChoice([], null);

    expect(choice.scope).toEqual({ kind: "library" });
    expect(choice.label).toBe("Export Library…");
    expect(choice.fileName).toBe("player-library.json");
  });

  it("exports the open playlist", () => {
    const choice = exportChoice([], { id: 4, name: "Evening" });

    expect(choice.scope).toEqual({ kind: "playlist", playlistId: 4 });
    expect(choice.label).toBe("Export Evening…");
    expect(choice.fileName).toBe("Evening.json");
  });

  it("prefers a selection over the playlist it sits in", () => {
    // Selecting rows inside a playlist is a narrower statement of intent than
    // having the playlist open, so it wins.
    const choice = exportChoice([1, 2, 3], { id: 4, name: "Evening" });

    expect(choice.scope).toEqual({ kind: "selection", trackIds: [1, 2, 3] });
    expect(choice.label).toBe("Export 3 Songs…");
  });

  it("says the count in the singular when it is one", () => {
    expect(exportChoice([7], null).label).toBe("Export 1 Song…");
  });

  it("copies the selection rather than aliasing it", () => {
    const selected = [1, 2];
    const choice = exportChoice(selected, null);
    selected.push(3);

    // The scope is handed to an async command; a live reference to the store's
    // array would let the selection change under it.
    expect(choice.scope).toEqual({ kind: "selection", trackIds: [1, 2] });
  });
});

describe("safeFileName", () => {
  it("replaces the characters Windows refuses", () => {
    expect(safeFileName("AC/DC: B-Sides?")).toBe("AC-DC- B-Sides-");
    expect(safeFileName('a<b>c|d*e"f\\g')).toBe("a-b-c-d-e-f-g");
  });

  it("leaves spaces alone, because they are legal", () => {
    expect(safeFileName("Road Trip")).toBe("Road Trip");
  });

  it("strips trailing dots and spaces, which are legal to type and not to store", () => {
    expect(safeFileName("Mix...")).toBe("Mix");
    expect(safeFileName("Mix ")).toBe("Mix");
  });

  it("falls back rather than producing an empty name", () => {
    expect(safeFileName("   ")).toBe("playlist");
    expect(safeFileName("")).toBe("playlist");
  });

  it("does not tidy a name that is legal once substituted", () => {
    // "---" is a perfectly usable file name; collapsing it further would be
    // tidying rather than fixing, and the user named it that.
    expect(safeFileName("///")).toBe("---");
  });
});
