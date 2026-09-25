import type { Meta, StoryObj } from "@storybook/react-vite";
import { inStatsPanels } from "../../../../.storybook/decorators";
import { LIBRARY } from "../../../../.storybook/fixtures";
import { statsHandlers } from "../../../../.storybook/handlers";
import type { TagHealth } from "../../../ipc";
import { TagHealthPanel } from "./TagHealthPanel";

const meta = {
  title: "Features/Statistics/TagHealthPanel",
  component: TagHealthPanel,
  parameters: { ipc: statsHandlers },
  decorators: [inStatsPanels],
} satisfies Meta<typeof TagHealthPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The one uncovered album. */
export const Gaps: Story = {};

export const Complete: Story = {
  parameters: {
    ipc: {
      stats_tag_health: (): TagHealth => ({
        tracks: LIBRARY.length,
        title: 0,
        artist: 0,
        album: 0,
        albumArtist: 0,
        genre: 0,
        year: 0,
        trackNo: 0,
        cover: 0,
      }),
    },
  },
};
