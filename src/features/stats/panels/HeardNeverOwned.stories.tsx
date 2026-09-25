import type { Meta, StoryObj } from "@storybook/react-vite";
import { inStatsPanels } from "../../../../.storybook/decorators";
import { emptyStatsHandlers, statsHandlers } from "../../../../.storybook/handlers";
import { openListening } from "../../../../.storybook/listening";
import { HeardNeverOwned } from "./HeardNeverOwned";

const meta = {
  title: "Features/Statistics/HeardNeverOwned",
  component: HeardNeverOwned,
  parameters: { ipc: statsHandlers },
  decorators: [inStatsPanels],
  beforeEach: () => openListening(),
} satisfies Meta<typeof HeardNeverOwned>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Export opens the save dialog, which answers cancelled. */
export const Tracks: Story = {};

export const Empty: Story = {
  parameters: { ipc: emptyStatsHandlers },
};
