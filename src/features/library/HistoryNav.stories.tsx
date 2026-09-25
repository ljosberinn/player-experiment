import type { Meta, StoryObj } from "@storybook/react-vite";
import { LIBRARY } from "../../../.storybook/fixtures";
import { libraryHandlers } from "../../../.storybook/handlers";
import { Sidebar } from "../../components/ui/Sidebar";
import type { Track } from "../../ipc";
import { HistoryNav } from "./HistoryNav";
import { useLibraryStore } from "./store";

/** Along the top of the sidebar, where `App` mounts it. */
function Top() {
  return (
    <div className="body" style={{ height: 160 }}>
      <Sidebar>
        <HistoryNav />
      </Sidebar>
    </div>
  );
}

const meta = {
  title: "Features/Library/HistoryNav",
  component: Top,
  // Each arrow navigates, and a navigation queries the library.
  parameters: { ipc: libraryHandlers },
} satisfies Meta<typeof Top>;

export default meta;

type Story = StoryObj<typeof meta>;

/** At launch, with nowhere to go either way. */
export const Nowhere: Story = {};

/** From Songs to Releases: back names Songs. */
export const BackOnly: Story = {
  beforeEach: async () => {
    await useLibraryStore.getState().showTab("albums");
  },
};

/** Into Harbour Lights and back out: forward names the album. */
export const BothWays: Story = {
  beforeEach: async () => {
    const library = useLibraryStore.getState();
    await library.showTab("albums");
    await library.showTrackGroup(LIBRARY[0] as Track);
    await library.back();
  },
};
