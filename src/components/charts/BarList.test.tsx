import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BarList, type BarListEntry } from "./BarList";

const entries: BarListEntry[] = [
  { key: "Boards of Canada", value: 412 },
  { key: "Aphex Twin", value: 206 },
  { key: "Autechre", value: 103 },
];

const count = (value: number) => value.toLocaleString();

function fills(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>(".bar-list-fill")].map(
    (fill) => fill.style.width,
  );
}

describe("BarList", () => {
  it("draws each fill as a share of the largest, not of the total", () => {
    // Ten rows of a long tail measured against the total would all be a
    // sliver; what a top list is asked is how the rows compare to each other.
    const { container } = render(<BarList entries={entries} format={count} empty="Nothing" />);

    expect(fills(container)).toEqual(["100%", "50%", "25%"]);
  });

  it("keeps the order it was given", () => {
    render(<BarList entries={entries} format={count} empty="Nothing" />);

    expect(screen.getAllByRole("listitem").map((row) => row.textContent?.slice(0, 7))).toEqual([
      "Boards ",
      "Aphex T",
      "Autechr",
    ]);
  });

  it("fills a single entry completely", () => {
    // The degenerate case a scale would map onto NaN or onto one pixel.
    const { container } = render(
      <BarList entries={[{ key: "Anchor", value: 1 }]} format={count} empty="Nothing" />,
    );

    expect(fills(container)).toEqual(["100%"]);
  });

  it("says why there is nothing rather than drawing an empty list", () => {
    render(<BarList entries={[]} format={count} empty="No plays in this range." />);

    expect(screen.getByText("No plays in this range.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows skeleton rows only before the first answer", () => {
    const { rerender } = render(
      <BarList entries={[]} format={count} empty="Nothing" loading={true} />,
    );
    expect(screen.getAllByTestId("bar-list-skeleton")).toHaveLength(5);

    // A refetch under a new range keeps what is drawn: blanking every panel
    // on each change makes the whole view flash.
    rerender(<BarList entries={entries} format={count} empty="Nothing" loading={true} />);
    expect(screen.queryByTestId("bar-list-skeleton")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("is a list of buttons only where a row leads somewhere", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<BarList entries={entries} format={count} empty="Nothing" />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);

    rerender(<BarList entries={entries} format={count} empty="Nothing" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Aphex Twin/ }));

    expect(onSelect).toHaveBeenCalledWith(entries[1]);
  });

  it("keeps two same-named rows apart by what they belong to", () => {
    // Two albums called Untitled by different artists are two rows, and a key
    // on the label alone would collapse them into a React key collision.
    render(
      <BarList
        entries={[
          { key: "Untitled", secondary: "Nas", value: 9 },
          { key: "Untitled", secondary: "Interpol", value: 4 },
        ]}
        format={count}
        empty="Nothing"
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Interpol")).toBeInTheDocument();
  });
});
