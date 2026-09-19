import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setGenreOverride } from "../../../ipc";
import { useStatsStore } from "../store";
import { GenreOverrideDialog } from "./GenreOverrideDialog";

vi.mock("../../../ipc", () => ({
  genreSuggestions: vi.fn(async () => []),
  setGenreOverride: vi.fn(async () => undefined),
  clearGenreOverride: vi.fn(async () => undefined),
  loadStatsFilters: vi.fn(async () => null),
  saveStatsFilters: vi.fn(async () => undefined),
}));

const setMock = vi.mocked(setGenreOverride);

beforeEach(() => {
  vi.clearAllMocks();
  useStatsStore.setState({ genreVersion: 0 });
});

function open(genre = "atmospheric black metal") {
  render(<GenreOverrideDialog genre={genre} onClose={vi.fn()} />);
}

describe("GenreOverrideDialog", () => {
  it("opens on the genre it was asked about", () => {
    open();

    expect(screen.getByLabelText("Genre")).toHaveProperty("value", "atmospheric black metal");
  });

  it("files the genre under the parent that was typed", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText("Belongs under"), "doom metal");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(setMock).toHaveBeenCalledWith("atmospheric black metal", "doom metal"),
    );
  });

  it("sends an empty parent as a root rather than as an empty label", async () => {
    // `set_override(label, None)` is the correction "this genre is a root",
    // which is a different act from clearing the override. An empty string
    // would be a label the tree does not know.
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(setMock).toHaveBeenCalledWith("atmospheric black metal", null));
  });

  it("shows a refusal beside the field instead of closing", async () => {
    // The status bar is a long way from what was typed, and both refusals are
    // written to be read: `set_override` names the genre and the parent.
    const user = userEvent.setup();
    setMock.mockRejectedValueOnce(
      new Error('"black metal" is at or above "atmospheric black metal"'),
    );
    const onClose = vi.fn();
    render(<GenreOverrideDialog genre="black metal" onClose={onClose} />);

    await user.type(screen.getByLabelText("Belongs under"), "atmospheric black metal");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("at or above"),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("bumps the genre version so every panel refetches", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText("Belongs under"), "doom metal");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(useStatsStore.getState().genreVersion).toBe(1));
  });
});
