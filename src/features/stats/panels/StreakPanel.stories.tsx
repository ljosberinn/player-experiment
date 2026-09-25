import type { Meta, StoryObj } from "@storybook/react-vite";
import { inStatsPanels } from "../../../../.storybook/decorators";
import { emptyStatsHandlers, statsHandlers } from "../../../../.storybook/handlers";
import { openListening } from "../../../../.storybook/listening";
import type { Streaks } from "../../../ipc";
import { StreakPanel } from "./StreakPanel";

const meta = {
  title: "Features/Statistics/StreakPanel",
  component: StreakPanel,
  parameters: { ipc: statsHandlers },
  decorators: [inStatsPanels],
  beforeEach: () => openListening(),
} satisfies Meta<typeof StreakPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The log has a play on each of its last sixteen days. */
export const Ongoing: Story = {};

const BROKEN: Streaks = {
  current: 0,
  longest: 23,
  longestFrom: "2026-04-02",
  longestTo: "2026-04-24",
  lastSeven: [true, true, false, true, false, false, false],
};

/** Nothing today or yesterday, so the run is over. */
export const Broken: Story = {
  parameters: { ipc: { stats_streaks: () => BROKEN } },
};

export const None: Story = {
  parameters: { ipc: emptyStatsHandlers },
};
