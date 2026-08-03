import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu, type MenuItem } from "./ContextMenu";

/**
 * Opens the menu the way a user does: right-click the region it belongs to.
 *
 * The setup changed with the API and the assertions did not, which is the
 * point - `getByRole("menuitem")` and the arrow keys are what Base UI's roles
 * and keyboard handling satisfy. A menu rendered `open` at a captured position
 * has no trigger, and Base UI routes arrow keys through the trigger, so the
 * position-based adapter this phase started from failed exactly these tests.
 */
async function open(items: MenuItem[], onOpenChange = vi.fn()) {
  const user = userEvent.setup();
  render(
    <ContextMenu items={items} onOpenChange={onOpenChange} render={<div />}>
      <span>right-click me</span>
    </ContextMenu>,
  );

  await user.pointer({ keys: "[MouseRight]", target: screen.getByText("right-click me") });
  await screen.findByRole("menu");

  return { onOpenChange, user };
}

describe("ContextMenu", () => {
  it("runs the item that was clicked and closes", async () => {
    const onSelect = vi.fn();
    const { onOpenChange, user } = await open([{ label: "Play", onSelect }]);

    await user.click(screen.getByRole("menuitem", { name: "Play" }));

    expect(onSelect).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenLastCalledWith(false, expect.anything());
  });

  it("moves through items with the arrow keys and picks with Enter", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { user } = await open([
      { label: "Play", onSelect: first },
      { label: "Get Info", onSelect: second },
    ]);

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    // A menu you can only click is half a menu.
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });

  it("wraps around at both ends", async () => {
    const last = vi.fn();
    const { user } = await open([{ label: "Play" }, { label: "Get Info", onSelect: last }]);

    // Up from before the first item reaches the last, so a long menu's bottom
    // entry is one keystroke away rather than five.
    await user.keyboard("{ArrowUp}{Enter}");

    expect(last).toHaveBeenCalled();
  });

  it("lets the keyboard reach a disabled item but not fire it", async () => {
    // A behaviour change, and a deliberate one on Base UI's part: it hard-codes
    // `disabledIndices` to empty, so arrow keys land on disabled items instead
    // of stepping over them. That is the ARIA menu recommendation - a disabled
    // entry the keyboard cannot reach is an entry a keyboard user never learns
    // exists. The hand-rolled menu skipped them.
    //
    // What has to hold either way is that landing on one does nothing, and the
    // menu stays open rather than closing on a no-op.
    const never = vi.fn();
    const after = vi.fn();
    const { user } = await open([
      { label: "Play" },
      { label: "Show in Explorer", disabled: true, onSelect: never },
      { label: "Export…", onSelect: after },
    ]);

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(never).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();

    // And the item past it is still reachable, so nothing is stranded behind
    // a disabled entry.
    await user.keyboard("{ArrowDown}{Enter}");
    expect(after).toHaveBeenCalled();
  });

  it("does not run a disabled item that is clicked", async () => {
    const onSelect = vi.fn();
    const { user } = await open([{ label: "Show in Explorer", disabled: true, onSelect }]);

    await user.click(screen.getByRole("menuitem", { name: "Show in Explorer" }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes on Escape without running anything", async () => {
    const onSelect = vi.fn();
    const { user } = await open([{ label: "Delete", onSelect }]);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes when something outside it is clicked", async () => {
    const { user } = await open([{ label: "Play" }]);

    await user.click(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("skips separators when moving with the keyboard", async () => {
    const after = vi.fn();
    const { user } = await open([
      { label: "Play" },
      { kind: "separator" },
      { label: "Delete", onSelect: after },
    ]);

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(after).toHaveBeenCalled();
  });

  it("renders no popup at all when there is nothing to offer", async () => {
    const user = userEvent.setup();
    render(
      <ContextMenu items={[]} render={<div />}>
        <span>right-click me</span>
      </ContextMenu>,
    );

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("right-click me") });

    // An empty box is worse than nothing. Rows whose page has not arrived have
    // no actions, and the trigger covers them too.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  describe("submenus", () => {
    const withSub = (onSelect: () => void): MenuItem[] => [
      { label: "Play" },
      { label: "Add to Playlist", submenu: [{ label: "Evening", onSelect }] },
    ];

    it("opens on ArrowRight and picks from within", async () => {
      const onSelect = vi.fn();
      const { user } = await open(withSub(onSelect));

      await user.keyboard("{ArrowDown}{ArrowDown}{ArrowRight}");
      await user.click(await screen.findByRole("menuitem", { name: "Evening" }));

      expect(onSelect).toHaveBeenCalled();
    });

    it("says it has one, and whether it is open", async () => {
      const { user } = await open(withSub(vi.fn()));
      const parent = screen.getByRole("menuitem", { name: /Add to Playlist/ });

      expect(parent).toHaveAttribute("aria-haspopup", "menu");
      expect(parent).toHaveAttribute("aria-expanded", "false");

      await user.keyboard("{ArrowDown}{ArrowDown}{ArrowRight}");

      expect(screen.getByRole("menuitem", { name: /Add to Playlist/ })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    it("closes the submenu on Escape before closing the menu", async () => {
      const { user } = await open(withSub(vi.fn()));

      await user.keyboard("{ArrowDown}{ArrowDown}{ArrowRight}");
      await screen.findByRole("menuitem", { name: "Evening" });

      await user.keyboard("{Escape}");

      // One Escape backs out one level, the way a nested menu should.
      expect(screen.queryByRole("menuitem", { name: "Evening" })).not.toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /Add to Playlist/ })).toBeInTheDocument();

      await user.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("says so when there is nothing to add to", async () => {
      const { user } = await open([{ label: "Add to Playlist", submenu: [] }]);

      await user.keyboard("{ArrowDown}{ArrowRight}");

      // An empty submenu that renders nothing looks broken; this explains it.
      expect(await screen.findByText("No playlists yet")).toBeInTheDocument();
    });
  });
});
