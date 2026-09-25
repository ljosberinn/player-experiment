import type { Meta, StoryObj } from "@storybook/react-vite";
import { MENUS } from "../../../.storybook/fixtures";
import { SearchBox } from "../../features/library/SearchBox";
import { AppBar } from "./AppBar";
import { MenuBar } from "./MenuBar";

/**
 * The bar as the app fills it, with a version and before `get_app_info` has
 * answered.
 *
 * `SearchBox` is the real field, because the version's place depends on it:
 * the field takes the free space. What typing into it does is the library
 * stories' concern.
 */
function States() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: "24px 0" }}>
      <AppBar version="0.19.0">
        <MenuBar menus={MENUS} />
        <SearchBox />
      </AppBar>
      <AppBar version={null}>
        <MenuBar menus={MENUS} />
        <SearchBox />
      </AppBar>
    </div>
  );
}

const meta = {
  title: "UI/AppBar",
  component: States,
} satisfies Meta<typeof States>;

export default meta;

export const State: StoryObj<typeof meta> = {};
