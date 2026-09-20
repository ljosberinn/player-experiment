import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AlbumGroup, statsAlbumGroup, statsPinAlbum } from "../../../ipc";
import { useStatsStore } from "../store";
import { AlbumLinkDialog } from "./AlbumLinkDialog";

const { GROUP } = vi.hoisted(() => ({
  GROUP: {
    heading: "Addicts: Black Meddle Pt. 2",
    artist: "Nachtmystium",
    members: [
      { album: "Addicts: Black Meddle Pt. 2", plays: 929, pinned: false },
      { album: "Addicts: Black Meddle Pt. II", plays: 132, pinned: false },
      { album: "Addicts: Black Meddle, Pt. II", plays: 50, pinned: false },
    ],
    others: [
      { heading: "Instinct: Decay", plays: 204, albums: ["Instinct: Decay"] },
      {
        heading: "Black Meddle Anthology",
        plays: 12,
        albums: ["Black Meddle Anthology", "Black Meddle Anthology (Explicit)"],
      },
    ],
  } satisfies AlbumGroup,
}));

vi.mock("../../../ipc", () => ({
  statsAlbumGroup: vi.fn(async () => GROUP),
  statsPinAlbum: vi.fn(async () => undefined),
  loadStatsFilters: vi.fn(async () => null),
  saveStatsFilters: vi.fn(async () => undefined),
  setGenreOverride: vi.fn(async () => undefined),
  clearGenreOverride: vi.fn(async () => undefined),
}));

const groupMock = vi.mocked(statsAlbumGroup);
const pinMock = vi.mocked(statsPinAlbum);

beforeEach(() => {
  vi.clearAllMocks();
  useStatsStore.setState({ groupVersion: 0 });
});

function open(onClose = vi.fn(), onRenamed = vi.fn()) {
  render(<AlbumLinkDialog heading={GROUP.heading} onClose={onClose} onRenamed={onRenamed} />);
  return { onClose, onRenamed };
}

/** The row for one spelling, once the group has landed. */
async function separate(album: string) {
  const row = (await screen.findByText(album)).closest("li");
  if (row === null) {
    throw new Error(`no row for ${album}`);
  }
  return within(row).getByRole("button", { name: "Separate" });
}

describe("AlbumLinkDialog", () => {
  it("lists the spellings folded into the group with their play counts", async () => {
    open();

    await waitFor(() => expect(groupMock).toHaveBeenCalledWith(GROUP.heading));
    expect(within(await screen.findByRole("list")).getAllByRole("listitem")).toHaveLength(3);
    expect((await screen.findByText("Addicts: Black Meddle Pt. II")).closest("li")).toHaveProperty(
      "textContent",
      expect.stringContaining("132"),
    );
  });

  it("retitles the group by pinning every spelling with the new heading", async () => {
    const user = userEvent.setup();
    open();
    const field = await screen.findByLabelText("Shown as");

    await user.clear(field);
    await user.type(field, "Addicts: Black Meddle");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(pinMock).toHaveBeenCalledWith(
        "Nachtmystium",
        GROUP.members.map((member) => member.album),
        "Addicts: Black Meddle",
      ),
    );
  });

  it("separates one spelling by pinning it with its own", async () => {
    const user = userEvent.setup();
    open();

    await user.click(await separate("Addicts: Black Meddle, Pt. II"));

    await waitFor(() =>
      expect(pinMock).toHaveBeenCalledWith(
        "Nachtmystium",
        ["Addicts: Black Meddle, Pt. II"],
        "Addicts: Black Meddle, Pt. II",
      ),
    );
  });

  it("merges another album in by pinning every spelling it has", async () => {
    const user = userEvent.setup();
    open();

    await user.selectOptions(await screen.findByLabelText("Merge in"), "Black Meddle Anthology");
    await user.click(screen.getByRole("button", { name: "Merge" }));

    await waitFor(() =>
      expect(pinMock).toHaveBeenCalledWith(
        "Nachtmystium",
        ["Black Meddle Anthology", "Black Meddle Anthology (Explicit)"],
        GROUP.heading,
      ),
    );
  });

  it("shows a refusal beside the field instead of closing", async () => {
    const user = userEvent.setup();
    pinMock.mockRejectedValueOnce(new Error("An album group needs a heading."));
    const { onClose } = open();
    const field = await screen.findByLabelText("Shown as");

    await user.clear(field);
    await user.type(field, "x");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("needs a heading"),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("bumps the group version so every listening panel refetches", async () => {
    const user = userEvent.setup();
    open();

    await user.click(await separate("Addicts: Black Meddle Pt. II"));

    await waitFor(() => expect(useStatsStore.getState().groupVersion).toBe(1));
  });

  /** The crumb the dialog was opened from names the old heading, and a drill
   *  on a heading nothing reads under is an empty tab. */
  it("reports a retitle, so the drill-down follows the group", async () => {
    const user = userEvent.setup();
    const { onRenamed } = open();
    const field = await screen.findByLabelText("Shown as");

    await user.clear(field);
    await user.type(field, "Addicts: Black Meddle");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onRenamed).toHaveBeenCalledWith("Addicts: Black Meddle"));
  });

  it("says nothing about a rename when only a spelling moved", async () => {
    const user = userEvent.setup();
    const { onRenamed } = open();

    await user.click(await separate("Addicts: Black Meddle, Pt. II"));

    await waitFor(() => expect(pinMock).toHaveBeenCalled());
    expect(onRenamed).not.toHaveBeenCalled();
  });
});
