import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CANDIDATES,
  HARBOUR_LIGHTS,
  HARBOUR_LIGHTS_DETAIL,
  REVIEW_QUEUE,
  SELECTION,
} from "../../../.storybook/fixtures";
import { editingHandlers } from "../../../.storybook/handlers";
import { defaultAssignment } from "./mapping";
import { ReleaseLookup } from "./ReleaseLookup";
import { useTagsourceStore } from "./store";

type Seed = Partial<ReturnType<typeof useTagsourceStore.getState>>;

/**
 * On Harbour Lights, the first release of a selection. The stages between
 * requests are over in a moment in the app, so each is seeded rather than
 * reached through the store's own actions.
 */
function onHarbourLights(seed: Seed) {
  useTagsourceStore.setState({ queue: SELECTION, index: 0, tracks: HARBOUR_LIGHTS, ...seed });
}

/** A pressing picked and its tracklist mapped onto the files. */
const PICKED: Seed = {
  candidates: CANDIDATES,
  detail: HARBOUR_LIGHTS_DETAIL,
  assignment: defaultAssignment(HARBOUR_LIGHTS, HARBOUR_LIGHTS_DETAIL.tracks),
};

const meta = {
  title: "Features/Editing/ReleaseLookup",
  component: ReleaseLookup,
  parameters: { ipc: editingHandlers },
} satisfies Meta<typeof ReleaseLookup>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Opening: Story = {
  beforeEach: () => onHarbourLights({ stage: "opening", tracks: [] }),
};

export const Searching: Story = {
  beforeEach: () => onHarbourLights({ stage: "searching" }),
};

export const Results: Story = {
  beforeEach: () => onHarbourLights({ stage: "results", candidates: CANDIDATES }),
};

export const NoResults: Story = {
  beforeEach: () => onHarbourLights({ stage: "results" }),
};

export const SearchFailed: Story = {
  beforeEach: () =>
    onHarbourLights({
      stage: "results",
      error: "MusicBrainz is not answering (503 Service Unavailable). Try again in a minute.",
    }),
};

export const Fetching: Story = {
  beforeEach: () => onHarbourLights({ stage: "fetching", candidates: CANDIDATES }),
};

/** Four files the pressing would change, and three it would leave alone. */
export const Confirm: Story = {
  beforeEach: () => onHarbourLights({ stage: "confirm", ...PICKED }),
};

export const Applying: Story = {
  beforeEach: () =>
    onHarbourLights({
      stage: "applying",
      ...PICKED,
      progress: { done: 3, total: HARBOUR_LIGHTS.length },
    }),
};

/** The review queue, which arrives with the pass's scores and candidates and offers Set Aside. */
export const FromReviewQueue: Story = {
  beforeEach: () =>
    useTagsourceStore.setState({
      queue: REVIEW_QUEUE,
      index: 0,
      fromReview: true,
      tracks: HARBOUR_LIGHTS,
      stage: "results",
      candidates: CANDIDATES,
    }),
};

/** What an apply or Set Aside leaves behind on the review queue. */
export const NothingSelected: Story = {
  beforeEach: () =>
    useTagsourceStore.setState({ queue: REVIEW_QUEUE.slice(1), index: null, fromReview: true }),
};
