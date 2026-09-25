import type { Meta, StoryObj } from "@storybook/react-vite";
import { inStatsPanels } from "../../../../.storybook/decorators";
import { emptyStatsHandlers, statsHandlers } from "../../../../.storybook/handlers";
import { openListening } from "../../../../.storybook/listening";
import { WeekClock } from "./WeekClock";

const meta = {
  title: "Features/Statistics/WeekClock",
  component: WeekClock,
  parameters: { ipc: statsHandlers },
  decorators: [inStatsPanels],
  beforeEach: () => openListening(),
} satisfies Meta<typeof WeekClock>;

export default meta;

type Story = StoryObj<typeof meta>;

/** All time: busy evenings and weekends, empty small hours. */
export const Dense: Story = {};

/** The last seven days, a few dozen plays. */
export const Sparse: Story = {
  beforeEach: () => openListening({ range: "days7" }),
};

/** All zeroes, which the panel draws as one empty chart rather than two. */
export const Empty: Story = {
  parameters: { ipc: emptyStatsHandlers },
};
