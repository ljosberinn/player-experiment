import type { Meta, StoryObj } from "@storybook/react-vite";
import { screen, userEvent } from "storybook/test";
import { inStatsPanels } from "../../../../.storybook/decorators";
import { emptyStatsHandlers, statsHandlers } from "../../../../.storybook/handlers";
import { openListening } from "../../../../.storybook/listening";
import { TopPanel } from "./TopPanel";

const meta = {
  title: "Features/Statistics/TopPanel",
  component: TopPanel,
  args: { dimension: "artist" },
  parameters: { ipc: statsHandlers },
  decorators: [inStatsPanels],
  beforeEach: () => openListening(),
} satisfies Meta<typeof TopPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Artists: Story = {};

export const Albums: Story = {
  args: { dimension: "album" },
};

export const Tracks: Story = {
  args: { dimension: "track" },
};

/** Only a play matched to a file has a genre, so the caption says how many that is. */
export const Genres: Story = {
  args: { dimension: "genre" },
};

export const Empty: Story = {
  parameters: { ipc: emptyStatsHandlers },
};

/**
 * Drilled into Harbour Lights, which was also scrobbled under its deluxe
 * title. Only a drilled album offers to fix its grouping.
 */
export const AlbumLinkDialog: Story = {
  args: { dimension: "album" },
  beforeEach: () => openListening({}, { kind: "album", key: "Harbour Lights" }),
  play: async () => {
    await userEvent.click(await screen.findByRole("button", { name: "Fix the grouping…" }));
    await screen.findByText("Harbour Lights (Deluxe Edition)");
  },
};
