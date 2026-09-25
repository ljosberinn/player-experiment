import type { Meta, StoryObj } from "@storybook/react-vite";
import { inStatsPanels } from "../../../../.storybook/decorators";
import { emptyStatsHandlers, statsHandlers } from "../../../../.storybook/handlers";
import { openListening } from "../../../../.storybook/listening";
import { RecentPlays } from "./RecentPlays";

const meta = {
  title: "Features/Statistics/RecentPlays",
  component: RecentPlays,
  parameters: { ipc: statsHandlers },
  decorators: [inStatsPanels],
  beforeEach: () => openListening(),
} satisfies Meta<typeof RecentPlays>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The whole log, a hundred at a time as it scrolls. The undated plays come last. */
export const SeveralPages: Story = {};

/** The last seven days, which one page holds. */
export const OnePage: Story = {
  beforeEach: () => openListening({ range: "days7" }),
};

export const Empty: Story = {
  parameters: { ipc: emptyStatsHandlers },
};
