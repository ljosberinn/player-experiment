import type { Meta, StoryObj } from "@storybook/react-vite";
import { MENUS } from "../../../.storybook/fixtures";
import { AppBar } from "../../components/ui/AppBar";
import { MenuBar } from "../../components/ui/MenuBar";
import { SearchBox } from "../library/SearchBox";
import { useUpdaterStore } from "./store";
import { UpdateButton } from "./UpdateButton";

/** On the app bar beside the version, which is where `App` puts it. */
function Bar() {
  return (
    <AppBar version="0.19.0" update={<UpdateButton />} search={<SearchBox />}>
      <MenuBar menus={MENUS} />
    </AppBar>
  );
}

const meta = {
  title: "Features/Updater/UpdateButton",
  component: Bar,
} satisfies Meta<typeof Bar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Nothing to install: nothing drawn. */
export const NoUpdate: Story = {};

export const Ready: Story = {
  beforeEach: () => {
    useUpdaterStore.setState({ status: "ready", version: "0.20.0" });
  },
};

export const Installing: Story = {
  beforeEach: () => {
    useUpdaterStore.setState({ status: "installing", version: "0.20.0" });
  },
};
