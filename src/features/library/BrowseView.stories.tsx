import type { Meta, StoryObj } from "@storybook/react-vite";
import { libraryHandlers } from "../../../.storybook/handlers";
import { BrowseView } from "./BrowseView";
import { useLibraryStore } from "./store";

const meta = {
  title: "Features/Library/BrowseView",
  component: BrowseView,
  parameters: { ipc: libraryHandlers },
  decorators: [
    // `SongTable`'s reason: the virtualizer needs a parent with a height.
    (Story) => (
      <main className="content" style={{ height: 720 }}>
        <Story />
      </main>
    ),
  ],
  beforeEach: async ({ args }) => {
    await useLibraryStore.getState().showTab(args.kind);
  },
} satisfies Meta<typeof BrowseView>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The grid, with one release that has no cover. */
export const Releases: Story = { args: { kind: "albums" } };

export const Artists: Story = { args: { kind: "artists" } };

export const Genres: Story = { args: { kind: "genres" } };

export const NoSongs: Story = {
  args: { kind: "albums" },
  parameters: { ipc: { browse_groups: () => [] } },
};

export const NoResults: Story = {
  args: { kind: "albums" },
  beforeEach: async () => {
    useLibraryStore.setState({ searchInput: "bagpipes", search: "bagpipes" });
    await useLibraryStore.getState().refresh();
  },
};
