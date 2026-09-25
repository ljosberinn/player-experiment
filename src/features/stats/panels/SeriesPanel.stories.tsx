import type { Meta, StoryObj } from "@storybook/react-vite";
import { inStatsPanels } from "../../../../.storybook/decorators";
import { emptyStatsHandlers, statsHandlers } from "../../../../.storybook/handlers";
import { openListening } from "../../../../.storybook/listening";
import { statsFirsts, statsPlaysOverTime } from "../../../ipc";
import { SeriesPanel } from "./SeriesPanel";

const meta = {
  title: "Features/Statistics/SeriesPanel",
  component: SeriesPanel,
  args: { title: "Plays over time", aggregate: statsPlaysOverTime, noun: "Plays", whole: "plays" },
  parameters: { ipc: statsHandlers },
  decorators: [inStatsPanels],
  beforeEach: () => openListening(),
} satisfies Meta<typeof SeriesPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Eighteen months, so cut by month. */
export const PlaysOverTime: Story = {};

/** The Lanterns were first heard undated, so the caption says they are not placed. */
export const NewArtists: Story = {
  args: { title: "New artists", aggregate: statsFirsts, noun: "Artists", whole: "artists" },
};

export const Empty: Story = {
  parameters: { ipc: emptyStatsHandlers },
};
