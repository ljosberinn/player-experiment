import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu, type MenuItem } from "./ContextMenu";

const at = { x: 40, y: 60 };

function open(items: MenuItem[], onClose = vi.fn()) {
  render(<ContextMenu items={items} position={at} onClose={onClose} />);
  return { onClose, user: userEvent.setup() };
}

describe("ContextMenu", () => {
  it("runs the item that was clicked and closes", async () => {
    const onSelect = vi.fn();
    const { onClose, user } = open([{ label: "Play", onSelect }]);

    await user.click(screen.getByRole("menuitem", { name: "Play" }));

    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("moves through items with the arrow keys and picks with Enter", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { user } = open([
      { label: "Play", onSelect: first },
      { label: "Get Info", onSelect: second },
    ]);

    await user.keyboard("{ArrowDown}{Enter}");

    // A menu you can only click is half a menu.
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });

  it("wraps around at both ends", async () => {
    const first = vi.fn();
    const { user } = open([{ label: "Play", onSelect: first }, { label: "Get Info" }]);

    // Up from the first item reaches the last, so a long menu's bottom entry
    // is one keystroke away rather than five.
    await user.keyboard("{ArrowUp}{ArrowDown}{Enter}");

    expect(first).toHaveBeenCalled();
  });

  it("skips disabled items rather than landing on them", async () => {
    const reachable = vi.fn();
    const { user } = open([
      { label: "Play" },
      { label: "Show in Explorer", disabled: true, onSelect: vi.fn() },
      { label: "Export…", onSelect: reachable },
    ]);

    await user.keyboard("{ArrowDown}{Enter}");

    expect(reachable).toHaveBeenCalled();
  });

  it("does not run a disabled item that is clicked", async () => {
    const onSelect = vi.fn();
    const { onClose, user } = open([{ label: "Show in Explorer", disabled: true, onSelect }]);

    await user.click(screen.getByRole("menuitem", { name: "Show in Explorer" }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape without running anything", async () => {
    const onSelect = vi.fn();
    const { onClose, user } = open([{ label: "Delete", onSelect }]);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes when something outside it is clicked", async () => {
    const { onClose, user } = open([{ label: "Play" }]);

    await user.click(document.body);

    expect(onClose).toHaveBeenCalled();
  });

  it("closes when the view scrolls out from under it", () => {
    const { onClose } = open([{ label: "Play" }]);

    // The menu describes a specific row. Scrolling moves the rows and would
    // leave it pointing at a different one.
    window.dispatchEvent(new Event("scroll"));

    expect(onClose).toHaveBeenCalled();
  });

  it("skips separators when moving with the keyboard", async () => {
    const after = vi.fn();
    const { user } = open([
      { label: "Play" },
      { kind: "separator" },
      { label: "Delete", onSelect: after },
    ]);

    await user.keyboard("{ArrowDown}{Enter}");

    expect(after).toHaveBeenCalled();
  });

  describe("submenus", () => {
    const withSub = (onSelect: () => void): MenuItem[] => [
      { label: "Play" },
      { label: "Add to Playlist", submenu: [{ label: "Evening", onSelect }] },
    ];

    it("opens on ArrowRight and picks from within", async () => {
      const onSelect = vi.fn();
      const { user } = open(withSub(onSelect));

      await user.keyboard("{ArrowDown}{ArrowRight}");
      await user.click(await screen.findByRole("menuitem", { name: "Evening" }));

      expect(onSelect).toHaveBeenCalled();
    });

    it("says it has one, and whether it is open", async () => {
      const { user } = open(withSub(vi.fn()));
      const parent = screen.getByRole("menuitem", { name: /Add to Playlist/ });

      expect(parent).toHaveAttribute("aria-haspopup", "menu");
      expect(parent).toHaveAttribute("aria-expanded", "false");

      await user.keyboard("{ArrowDown}{ArrowRight}");

      expect(screen.getByRole("menuitem", { name: /Add to Playlist/ })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    it("closes the submenu on Escape before closing the menu", async () => {
      const { onClose, user } = open(withSub(vi.fn()));

      await user.keyboard("{ArrowDown}{ArrowRight}");
      await user.keyboard("{Escape}");

      // One Escape backs out one level, the way a nested menu should.
      expect(screen.queryByRole("menuitem", { name: "Evening" })).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();

      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalled();
    });

    it("says so when there is nothing to add to", async () => {
      const { user } = open([{ label: "Add to Playlist", submenu: [] }]);

      await user.keyboard("{ArrowRight}");

      // An empty submenu that renders nothing looks broken; this explains it.
      expect(await screen.findByText("No playlists yet")).toBeInTheDocument();
    });
  });
});
