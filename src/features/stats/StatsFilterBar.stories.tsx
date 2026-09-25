import type { Meta, StoryObj } from "@storybook/react-vite";
import { PLAYLISTS } from "../../../.storybook/fixtures";
import { statsHandlers } from "../../../.storybook/handlers";
import { usePlaylistsStore } from "../playlists/store";
import { DAY, DEFAULT_FILTERS, dateInputSeconds, type StatsFilters } from "./filters";
import type { StatsTab } from "./path";
import { StatsFilterBar } from "./StatsFilterBar";
import { StatsFilterTokens } from "./StatsFilterTokens";
import { useStatsStore } from "./store";

/** The bar and the token line under it, as `StatisticsView` stacks them. */
function FilterBar({ tab }: { tab: StatsTab }) {
  return (
    <div className="stats-view">
      <StatsFilterBar tab={tab} />
      <StatsFilterTokens tab={tab} />
    </div>
  );
}

function filtered(change: Partial<StatsFilters>) {
  usePlaylistsStore.setState({ playlists: PLAYLISTS });
  useStatsStore.setState({ filters: { ...DEFAULT_FILTERS, ...change } });
}

const meta = {
  title: "Features/Statistics/StatsFilterBar",
  component: FilterBar,
  args: { tab: "library" },
  parameters: { ipc: statsHandlers },
  decorators: [
    (Story) => (
      <main className="content">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof FilterBar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Every facet at its default, so no token line. */
export const NoFilters: Story = {};

export const Library: Story = {
  beforeEach: () => filtered({ scope: { kind: "playlist", playlistId: 1 }, genre: "Jazz" }),
};

/** February 2026, owned and not loved. */
export const Listening: Story = {
  args: { tab: "listening" },
  beforeEach: () =>
    filtered({
      range: "custom",
      custom: {
        from: dateInputSeconds("2026-02-01") as number,
        to: (dateInputSeconds("2026-02-28") as number) + DAY,
      },
      owned: true,
      loved: false,
    }),
};
