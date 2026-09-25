import type { Meta, StoryObj } from "@storybook/react-vite";
import { inStatsPanels } from "../../../../.storybook/decorators";
import { emptyStatsHandlers, statsHandlers } from "../../../../.storybook/handlers";
import { openListening } from "../../../../.storybook/listening";
import { statsFirsts } from "../../../ipc";
import { NewArtistList } from "./NewArtistList";
import { SeriesPanel } from "./SeriesPanel";

/** Drawn in the panel it lives in, under the chart and its caption. */
const meta = {
  title: "Features/Statistics/NewArtistList",
  component: SeriesPanel,
  args: {
    title: "New artists",
    aggregate: statsFirsts,
    noun: "Artists",
    whole: "artists",
  },
  parameters: { ipc: statsHandlers },
  decorators: [inStatsPanels],
  beforeEach: () => openListening(),
  render: (args) => (
    <SeriesPanel {...args}>
      <NewArtistList />
    </SeriesPanel>
  ),
} satisfies Meta<typeof SeriesPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** All time: the latest discoveries first. The Lanterns were first heard undated, so are not among them. */
export const List: Story = {};

/** Nobody was new, so the chart says so and the list draws nothing. */
export const Empty: Story = {
  parameters: { ipc: emptyStatsHandlers },
};
