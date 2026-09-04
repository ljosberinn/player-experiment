import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tagsourceRestoreReview, tagsourceReviewCounts, tagsourceReviewQueue } from "../../ipc";
import { ReviewQueue } from "./ReviewQueue";
import { useTagsourceStore } from "./store";

vi.mock("../../ipc", () => ({
  INVALIDATE_DEBOUNCE_MS: 250,
  onLibraryChanged: vi.fn(async () => () => {}),
  onTagWriteProgress: vi.fn(async () => () => {}),
  tagsourceApply: vi.fn(),
  tagsourceFetch: vi.fn(),
  tagsourceGroups: vi.fn(),
  tagsourceRestoreReview: vi.fn(async () => 0),
  tagsourceReviewCounts: vi.fn(async () => ({ review: 0, aside: 0 })),
  tagsourceReviewQueue: vi.fn(async () => []),
  tagsourceSearch: vi.fn(),
  tagsourceSetAside: vi.fn(),
  tracksByIds: vi.fn(async () => []),
}));

const initial = useTagsourceStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useTagsourceStore.setState(initial, true);
  vi.mocked(tagsourceReviewCounts).mockResolvedValue({ review: 0, aside: 0 });
  vi.mocked(tagsourceReviewQueue).mockResolvedValue([]);
});

/** Renders the row and waits for the count it draws itself from. */
async function mounted(counts: { review: number; aside: number }) {
  vi.mocked(tagsourceReviewCounts).mockResolvedValue(counts);
  const view = render(<ReviewQueue />);
  await waitFor(() => expect(useTagsourceStore.getState().review).toBe(counts.review));
  return view;
}

describe("ReviewQueue", () => {
  /**
   * A row that says nought for the months before the pass has queued anything
   * is a permanent reminder of a feature with nothing to say.
   */
  it("is absent while there is nothing to review and nothing set aside", async () => {
    await mounted({ review: 0, aside: 0 });

    expect(screen.queryByRole("button", { name: "Needs Review" })).not.toBeInTheDocument();
  });

  it("carries the count the way a playlist carries its track count", async () => {
    await mounted({ review: 412, aside: 0 });

    expect(screen.getByRole("button", { name: "Needs Review" })).toHaveTextContent("412");
  });

  it("opens the lookup dialog on the queue", async () => {
    vi.mocked(tagsourceReviewQueue).mockResolvedValue([
      { album: "Loveless", artist: "My Bloody Valentine", trackIds: [1], candidates: [] },
    ]);
    await mounted({ review: 1, aside: 0 });

    await userEvent.click(screen.getByRole("button", { name: "Needs Review" }));

    await waitFor(() => expect(useTagsourceStore.getState().queue).toHaveLength(1));
    expect(useTagsourceStore.getState().fromReview).toBe(true);
  });

  /**
   * Setting a release aside has to have a way back or it is a trap, and the
   * way back cannot live inside a row that has hidden itself.
   */
  it("becomes the way back when every queued release has been set aside", async () => {
    vi.mocked(tagsourceRestoreReview).mockResolvedValue(7);
    await mounted({ review: 0, aside: 7 });

    const row = screen.getByRole("button", { name: "Set Aside" });
    expect(row).toHaveTextContent("7");
    await userEvent.click(row);

    expect(tagsourceRestoreReview).toHaveBeenCalled();
  });

  it("offers the way back from its menu while there is still a queue", async () => {
    vi.mocked(tagsourceRestoreReview).mockResolvedValue(7);
    await mounted({ review: 3, aside: 7 });

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Needs Review" }),
    });
    await userEvent.click(await screen.findByRole("menuitem", { name: "Bring Back 7 Set Aside" }));

    expect(tagsourceRestoreReview).toHaveBeenCalled();
  });
});
