import type { Meta, StoryObj } from "@storybook/react-vite";
import { inStatsPanels } from "../../../../.storybook/decorators";
import { emptyStatsHandlers, statsHandlers } from "../../../../.storybook/handlers";
import { useLibraryStore } from "../../library/store";
import { drill, statsRoot } from "../path";
import { GenreDonut } from "./GenreDonut";

const meta = {
  title: "Features/Statistics/GenreDonut",
  component: GenreDonut,
  parameters: { ipc: statsHandlers },
  decorators: [inStatsPanels],
  beforeEach: async () => {
    await useLibraryStore.getState().showStatsPath(statsRoot("library"));
  },
} satisfies Meta<typeof GenreDonut>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The roots. Rock and Pop drill; the other three are tagged as themselves. */
export const Genres: Story = {};

/** Drilled into Pop, whose one child is there by the suffix guess. */
export const OneGenre: Story = {
  beforeEach: async () => {
    await useLibraryStore
      .getState()
      .showStatsPath(drill(statsRoot("library"), { kind: "genre", key: "Pop" }));
  },
};

export const NoGenres: Story = {
  parameters: { ipc: emptyStatsHandlers },
};
