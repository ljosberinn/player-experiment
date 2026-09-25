import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";
import { REVIEW_COUNTS, reviewHandlers } from "../../../.storybook/handlers";
import { rightClick } from "../../../.storybook/play";
import { Sidebar } from "../../components/ui/Sidebar";
import { ReviewQueue } from "./ReviewQueue";

/** In the sidebar, under where the playlists would be. */
function Source() {
  return (
    <div className="body" style={{ height: 240 }}>
      <Sidebar>
        <ReviewQueue />
      </Sidebar>
    </div>
  );
}

const meta = {
  title: "Features/Library/ReviewQueue",
  component: Source,
  parameters: { ipc: reviewHandlers },
} satisfies Meta<typeof Source>;

export default meta;

type Story = StoryObj<typeof meta>;

export const NeedsReview: Story = {};

/** Everything set aside: the row is the way to put it back. */
export const SetAside: Story = {
  parameters: {
    ipc: { tagsource_review_counts: () => ({ review: 0, aside: REVIEW_COUNTS.aside }) },
  },
};

/** Nothing queued: the row is not drawn. */
export const Empty: Story = {
  parameters: { ipc: { tagsource_review_counts: () => ({ review: 0, aside: 0 }) } },
};

export const Menu: Story = {
  play: async ({ canvasElement }) => {
    await rightClick(await within(canvasElement).findByRole("button", { name: "Needs Review" }));
  },
};
