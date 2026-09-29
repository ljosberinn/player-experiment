import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette, matches, type PaletteGroup } from "./CommandPalette";

/** A button that opens the palette, so there is somewhere for focus to go back to. */
function Harness({ groups }: { groups: PaletteGroup[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open ? <CommandPalette groups={groups} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

async function open(groups: PaletteGroup[]) {
  const user = userEvent.setup();
  render(<Harness groups={groups} />);
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
