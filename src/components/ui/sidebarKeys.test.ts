import { describe, expect, it } from "vitest";
import { sidebarRows, stepRow, tabStopRow } from "./sidebarKeys";

/** A sidebar whose rows are marked `*` where `aria-current` sits. */
function nav(markup: string): HTMLElement {
  const element = document.createElement("nav");
  element.innerHTML = markup;
  return element;
}

const rows = (...labels: string[]) =>
  labels
    .map((label) =>
      label.startsWith("*")
        ? `<button class="sidebar-item" aria-current="page">${label.slice(1)}</button>`
        : `<button class="sidebar-item">${label}</button>`,
    )
    .join("");

describe("sidebarRows", () => {
  it("finds the rows across sections, in the order they are drawn", () => {
    const element = nav(
      `<div class="sidebar-section"><ul>${rows("Songs", "Releases")}</ul></div>` +
        `<div class="sidebar-section"><ul>${rows("Party")}</ul></div>`,
    );

    expect(sidebarRows(element).map((row) => row.textContent)).toEqual([
      "Songs",
      "Releases",
      "Party",
    ]);
  });

  it("leaves the headings' own controls out of the walk", () => {
    const element = nav(
      `<button class="sidebar-fold">Playlists</button>` +
        `<button class="sidebar-add">+</button>` +
        rows("Party"),
    );

    expect(sidebarRows(element)).toHaveLength(1);
  });
});

describe("tabStopRow", () => {
  it("is the open view", () => {
    expect(tabStopRow(sidebarRows(nav(rows("Songs", "*Releases", "Party"))))).toBe(1);
  });

  it("falls back to the first row when nothing is current", () => {
    expect(tabStopRow(sidebarRows(nav(rows("Songs", "Releases"))))).toBe(0);
  });
});

describe("stepRow", () => {
  it("moves one row either way", () => {
    expect(stepRow(1, 1, 5)).toBe(2);
    expect(stepRow(1, -1, 5)).toBe(0);
  });

  it("clamps at both ends rather than wrapping across sections", () => {
    expect(stepRow(0, -1, 5)).toBe(0);
    expect(stepRow(4, 1, 5)).toBe(4);
  });
});
