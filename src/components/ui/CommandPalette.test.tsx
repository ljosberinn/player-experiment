import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette, matches, type PaletteGroup } from "./CommandPalette";

/** A button that opens the palette, so there is somewhere for focus to go back to. */
function Harness({
  groups,
  searching,
  onQueryChange,
}: {
  groups: PaletteGroup[];
  searching?: boolean;
  onQueryChange?: (query: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open ? (
        <CommandPalette
          groups={groups}
          searching={searching}
          onQueryChange={onQueryChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

async function open(
  groups: PaletteGroup[],
  props: { searching?: boolean; onQueryChange?: (query: string) => void } = {},
) {
  const user = userEvent.setup();
  render(<Harness groups={groups} {...props} />);
  await user.click(screen.getByRole("button", { name: "Open" }));
  const field = await screen.findByRole("combobox", { name: "Search commands" });
  await waitFor(() => expect(field).toHaveFocus());
  return { user, field };
}

describe("CommandPalette", () => {
  it("filters its entries by what is typed", async () => {
    const { user } = await open([
      {
        group: "View",
        items: [
          { label: "Zoom In", onSelect: vi.fn() },
          { label: "Dark Theme", onSelect: vi.fn() },
        ],
      },
    ]);

    await user.keyboard("zoom");

    expect(screen.getByRole("option", { name: "Zoom In" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Dark Theme" })).toBeNull();
  });

  it("runs the highlighted entry on Enter and closes", async () => {
    const zoomIn = vi.fn();
    const { user } = await open([
      {
        group: "View",
        items: [
          { label: "Dark Theme", onSelect: vi.fn() },
          { label: "Zoom In", onSelect: zoomIn },
        ],
      },
    ]);

    await user.keyboard("zoom{Enter}");

    expect(zoomIn).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("highlights a greyed entry but does not run it", async () => {
    const greyed = vi.fn();
    const after = vi.fn();
    const { user } = await open([
      {
        group: "Export",
        items: [
          {
            label: "Export Selection…",
            disabled: true,
            hint: "Nothing selected",
            onSelect: greyed,
          },
          { label: "Export All…", onSelect: after },
        ],
      },
    ]);

    expect(
      screen.getByRole("option", { name: "Export Selection…. Nothing selected" }),
    ).toHaveAttribute("aria-disabled", "true");
    // Reachable, as in a menu: Base UI leaves `disabledIndices` empty for both.
    await user.keyboard("export{Enter}");

    expect(greyed).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{ArrowDown}{Enter}");

    expect(after).toHaveBeenCalledOnce();
  });

  it("closes on Escape and gives focus back", async () => {
    const { user } = await open([{ group: "Help", items: [{ label: "Source Code on GitHub" }] }]);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Open" })).toHaveFocus());
  });

  it("runs the one of two same-named entries that is highlighted", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { user } = await open([
      {
        group: "Playlists",
        items: [
          { id: "playlist:3", label: "New Playlist", onSelect: first },
          { id: "playlist:4", label: "New Playlist", onSelect: second },
        ],
      },
    ]);

    expect(screen.getAllByRole("option", { name: "New Playlist" })).toHaveLength(2);
    await user.keyboard("{ArrowDown}{Enter}");

    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it("announces an arrow chord in ARIA's spelling", async () => {
    await open([{ group: "Go to", items: [{ label: "Back to Songs", shortcut: "Alt+←" }] }]);

    expect(screen.getByRole("option", { name: "Back to Songs" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+ArrowLeft",
    );
  });

  it("draws a found group as given, below the commands it still filters", async () => {
    const onQueryChange = vi.fn();
    const { user } = await open(
      [
        {
          group: "View",
          items: [
            { label: "Zoom In", onSelect: vi.fn() },
            { label: "Dark Theme", onSelect: vi.fn() },
          ],
        },
        // Matched on a column the label does not show.
        { group: "Songs", found: true, items: [{ label: "Sleeping Ute", hint: "Grizzly Bear" }] },
      ],
      { onQueryChange },
    );

    await user.keyboard("zoom");

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Zoom In",
      "Sleeping UteGrizzly Bear",
    ]);
    expect(onQueryChange).toHaveBeenLastCalledWith("zoom");
  });

  it("runs a found entry that arrives after the typing", async () => {
    const play = vi.fn();
    const commands = { group: "Help", items: [{ label: "Source Code on GitHub" }] };
    const user = userEvent.setup();
    const { rerender } = render(<Harness groups={[commands]} searching />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Search commands" })).toHaveFocus(),
    );
    await user.keyboard("sleep");

    rerender(
      <Harness
        groups={[
          commands,
          { group: "Songs", found: true, items: [{ label: "Sleeping Ute", onSelect: play }] },
        ]}
      />,
    );
    await screen.findByRole("option", { name: "Sleeping Ute" });
    await user.keyboard("{Enter}");

    expect(play).toHaveBeenCalledOnce();
  });

  it("does not say nothing matches while a search is still coming", async () => {
    const { user } = await open([{ group: "Help", items: [{ label: "Source Code on GitHub" }] }], {
      searching: true,
    });

    await user.keyboard("grizzly");

    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.queryByText("No matching command.")).toBeNull();
  });

  it("says so when nothing matches", async () => {
    const { user } = await open([{ group: "Help", items: [{ label: "Source Code on GitHub" }] }]);

    await user.keyboard("qqq");

    expect(screen.getByText("No matching command.")).toBeInTheDocument();
  });
});

describe("matches", () => {
  it("finds every typed word, in any order, across a path", () => {
    expect(matches("Settings › Library", "settings library")).toBe(true);
    expect(matches("Settings › Library", "lib set")).toBe(true);
    expect(matches("Settings › Library", "settings online")).toBe(false);
    expect(matches("Zoom In", "  ")).toBe(true);
  });
});
