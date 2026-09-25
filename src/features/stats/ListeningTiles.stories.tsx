import type { Meta, StoryObj } from "@storybook/react-vite";
import { inStatsPanels } from "../../../.storybook/decorators";
import { emptyStatsHandlers, statsHandlers } from "../../../.storybook/handlers";
import { openListening } from "../../../.storybook/listening";
import { ListeningTiles } from "./ListeningTiles";

const meta = {
  title: "Features/Statistics/ListeningTiles",
  component: ListeningTiles,
  parameters: { ipc: statsHandlers },
  decorators: [inStatsPanels],
  beforeEach: () => openListening(),
} satisfies Meta<typeof ListeningTiles>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Unowned plays carry no duration, so Time spent says what share it covers. */
export const Totals: Story = {};

/** No plays at all draws the sentence pointing at the import, not a row of zeroes. */
export const NoPlays: Story = {
  parameters: { ipc: emptyStatsHandlers },
};
