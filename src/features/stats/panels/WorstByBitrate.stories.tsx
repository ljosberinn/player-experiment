import type { Meta, StoryObj } from "@storybook/react-vite";
import { inStatsPanels } from "../../../../.storybook/decorators";
import { statsHandlers } from "../../../../.storybook/handlers";
import { WorstByBitrate } from "./WorstByBitrate";

const meta = {
  title: "Features/Statistics/WorstByBitrate",
  component: WorstByBitrate,
  parameters: { ipc: statsHandlers },
  decorators: [inStatsPanels],
} satisfies Meta<typeof WorstByBitrate>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Every album, worst first. Export opens the save dialog, which answers cancelled. */
export const Albums: Story = {};

export const Empty: Story = {
  parameters: { ipc: { stats_worst_by_bitrate: () => [] } },
};
