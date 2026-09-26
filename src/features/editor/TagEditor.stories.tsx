import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen, userEvent } from "storybook/test";
import { HARBOUR_LIGHTS, LIBRARY } from "../../../.storybook/fixtures";
import { editingHandlers } from "../../../.storybook/handlers";
import type { Track } from "../../ipc";
import { useEditorStore } from "./store";
import { TagEditor } from "./TagEditor";

function byId(id: number): Track {
  return LIBRARY.find((entry) => entry.id === id) as Track;
}

const meta = {
  title: "Features/Editing/TagEditor",
  component: TagEditor,
  args: {
    tracks: [byId(1)],
    onSave: fn(),
    onCancel: fn(),
    onPickCover: fn(() => Promise.resolve("staged")),
    onDropCover: fn(() => Promise.resolve("staged")),
  },
  parameters: { ipc: editingHandlers },
} satisfies Meta<typeof TagEditor>;

export default meta;

type Story = StoryObj<typeof meta>;

export const OneSong: Story = {};

/**
 * Two albums by one band: the artist is shared, everything else reads Mixed,
 * and one of the albums has no artwork.
 */
export const SongsThatDisagree: Story = {
  args: { tracks: [byId(1), byId(2), byId(401)] },
};

/** A picked image waiting to be written, over the art it replaces. */
export const StagedArtwork: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole("button", { name: "Choose Artwork…" }));
    await screen.findByText("New artwork selected.");
  },
};

export const Writing: Story = {
  args: { tracks: HARBOUR_LIGHTS },
  beforeEach: () => {
    useEditorStore.setState({ progress: { done: 3, total: HARBOUR_LIGHTS.length } });
  },
};
