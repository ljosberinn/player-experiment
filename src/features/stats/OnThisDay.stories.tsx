import type { Meta, StoryObj } from "@storybook/react-vite";
import { inStatsPanels } from "../../../.storybook/decorators";
import { emptyStatsHandlers, onThisDayHandlers } from "../../../.storybook/handlers";
import { DEFAULT_FILTERS } from "./filters";
import { OnThisDay } from "./OnThisDay";
import { useStatsStore } from "./store";

const meta = {
  title: "Features/Statistics/OnThisDay",
  component: OnThisDay,
  parameters: { ipc: onThisDayHandlers },
  decorators: [inStatsPanels],
  beforeEach: () => useStatsStore.setState({ filters: DEFAULT_FILTERS }),
} satisfies Meta<typeof OnThisDay>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Today's date last year, if the log has it, and in four years before the log opens. */
export const SeveralYears: Story = {};

export const None: Story = {
  parameters: { ipc: emptyStatsHandlers },
};
