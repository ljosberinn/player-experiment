import type { Meta, StoryObj } from "@storybook/react-vite";
import { screen, userEvent } from "storybook/test";
import { inStatsPanels } from "../../../../.storybook/decorators";
import { statsHandlers } from "../../../../.storybook/handlers";
import { formatDuration } from "../../../lib/format";
import { HistogramPanel } from "./HistogramPanel";
import { ReleaseYears } from "./ReleaseYears";
import { SampleRates } from "./SampleRates";

/** As `LibraryPanels` configures them. */
const bitrates = (
  <HistogramPanel
    title="Bitrates"
    field="bitrate"
    bin={(kbps) => `${kbps}`}
    column="kbps"
    empty="Nothing here reports a bitrate."
  />
);

const lengths = (
  <HistogramPanel
    title="Track lengths"
    field="duration"
    bin={(ms) => formatDuration(ms)}
    column="Length"
    empty="Nothing here has a length."
  />
);

const meta = {
  title: "Features/Statistics/HistogramPanel",
  parameters: { ipc: statsHandlers },
  decorators: [inStatsPanels],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Bitrates: Story = { render: () => bitrates };

export const TrackLengths: Story = { render: () => lengths };

export const SampleRatesList: Story = { name: "Sample Rates", render: () => <SampleRates /> };

export const Years: Story = { name: "Release Years", render: () => <ReleaseYears /> };

export const Decades: Story = {
  name: "Release Decades",
  render: () => <ReleaseYears />,
  play: async () => {
    await userEvent.click(await screen.findByRole("button", { name: "By decade" }));
  },
};

/** All four over nothing. */
export const Empty: Story = {
  parameters: { ipc: { stats_histogram: () => [] } },
  render: () => (
    <>
      {bitrates}
      <SampleRates />
      {lengths}
      <ReleaseYears />
    </>
  ),
};
