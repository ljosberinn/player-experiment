import type { Meta, StoryObj } from "@storybook/react-vite";
import { screen, userEvent, within } from "storybook/test";
import { MENUS } from "../../../.storybook/fixtures";
import { MenuBar } from "./MenuBar";

/**
 * The bar's five menus, built by `menus()` as `AppMenus` builds them, with Edit
 * open on two selected songs. Left and Right walk to the others.
 */
function Bar() {
  return (
    <div className="appbar" style={{ marginTop: 24 }}>
      <MenuBar menus={MENUS} />
    </div>
  );
}

const meta = {
  title: "UI/MenuBar",
  component: Bar,
} satisfies Meta<typeof Bar>;

export default meta;

export const Open: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("menuitem", { name: "Edit" }));
    await screen.findByRole("menu", { name: "Edit" });
  },
};
