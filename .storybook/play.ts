import { screen, userEvent } from "storybook/test";

/**
 * Right-clicks the middle of `target` and waits for the menu. Coordinates
 * because `ContextMenu` places itself at the pointer, and without them the
 * menu opens at the corner of the page.
 */
export async function rightClick(target: Element): Promise<HTMLElement> {
  const box = target.getBoundingClientRect();
  await userEvent.pointer({
    keys: "[MouseRight]",
    target,
    coords: { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 },
  });
  return screen.findByRole("menu");
}
