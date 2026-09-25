import type { Meta, StoryObj } from "@storybook/react-vite";
import { inStatsPanels } from "../../../.storybook/decorators";
import { emptyStatsHandlers, statsHandlers } from "../../../.storybook/handlers";
import { LibraryTiles } from "./LibraryTiles";

const meta = {
  title: "Features/Statistics/LibraryTiles",
  component: LibraryTiles,
  parameters: { ipc: statsHandlers },
  decorators: [inStatsPanels],
} satisfies Meta<typeof LibraryTiles>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Totals: Story = {};

export const AllZero: Story = {
  parameters: { ipc: emptyStatsHandlers },
};
