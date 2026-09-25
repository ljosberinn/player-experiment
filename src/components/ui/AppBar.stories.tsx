import type { Meta, StoryObj } from "@storybook/react-vite";
import { MENUS } from "../../../.storybook/fixtures";
import { SearchBox } from "../../features/library/SearchBox";
import { AppBar } from "./AppBar";
import { MenuBar } from "./MenuBar";

/**
 * The bar as the app fills it, with a version and before `get_app_info` has
 * answered.
 *
 * `SearchBox` is the real field, because it takes the free space after the
 * version: the version follows Help, and neither the menus nor the field move
 * when it arrives. What typing into it does is the library stories' concern.
 */
function States() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: "24px 0" }}>
      <AppBar version="0.19.0" search={<SearchBox />}>
        <MenuBar menus={MENUS} />
      </AppBar>
      <AppBar version={null} search={<SearchBox />}>
        <MenuBar menus={MENUS} />
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
