import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listWatchFolders,
  loadWatchInterval,
  removeWatchFolder,
  saveWatchInterval,
} from "../../ipc";
import { WatchFolderSettings } from "./WatchFolderSettings";

vi.mock("../../ipc", () => ({
  listWatchFolders: vi.fn(async () => ["C:\\Music", "D:\\More Music"]),
  loadWatchInterval: vi.fn(async () => 15),
  removeWatchFolder: vi.fn(async () => undefined),
  saveWatchInterval: vi.fn(async () => undefined),
}));

function interval(): HTMLSelectElement {
  return screen.getByLabelText<HTMLSelectElement>("Check For Changes");
}

describe("the music folders section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listWatchFolders).mockResolvedValue(["C:\\Music", "D:\\More Music"]);
    vi.mocked(loadWatchInterval).mockResolvedValue(15);
  });

  it("lists what is being watched", async () => {
    render(<WatchFolderSettings />);

    expect(await screen.findByText("C:\\Music")).toBeInTheDocument();
    expect(screen.getByText("D:\\More Music")).toBeInTheDocument();
  });

  it("removes a folder and takes it out of the list", async () => {
    const user = userEvent.setup();
    render(<WatchFolderSettings />);
    await screen.findByText("C:\\Music");

    await user.click(screen.getByRole("button", { name: "Stop watching C:\\Music" }));

    expect(removeWatchFolder).toHaveBeenCalledWith("C:\\Music");
    await waitFor(() => expect(screen.queryByText("C:\\Music")).not.toBeInTheDocument());
    // Only the one that was asked for: the list is not reloaded, so a bug here
    // would take the other row with it and nothing else would notice.
    expect(screen.getByText("D:\\More Music")).toBeInTheDocument();
  });

  it("says so when nothing is watched, rather than showing an empty list", async () => {
    vi.mocked(listWatchFolders).mockResolvedValue([]);
    render(<WatchFolderSettings />);

    expect(await screen.findByText(/Nothing is being watched/)).toBeInTheDocument();
  });

  it("opens on the stored interval", async () => {
    vi.mocked(loadWatchInterval).mockResolvedValue(60);
    render(<WatchFolderSettings />);

    await waitFor(() => expect(interval().value).toBe("60"));
  });

  it("saves a new interval", async () => {
    const user = userEvent.setup();
    render(<WatchFolderSettings />);
    await waitFor(() => expect(interval().value).toBe("15"));

    await user.selectOptions(interval(), "30");

    expect(saveWatchInterval).toHaveBeenCalledWith(30);
    expect(interval().value).toBe("30");
  });

  it("offers turning the checks off", async () => {
    const user = userEvent.setup();
    render(<WatchFolderSettings />);
    await waitFor(() => expect(interval().value).toBe("15"));

    // Zero rather than a separate flag: off is an interval like any other, so
    // nothing downstream has two things to agree on.
    await user.selectOptions(interval(), "Never");

    expect(saveWatchInterval).toHaveBeenCalledWith(0);
  });

  it("says what removing a folder does to the songs in it", async () => {
    // The section cannot list a Remove button without it: the marking happens
    // later, on a pass nobody is watching, and a user who is not told will
    // read it as the app losing their library.
    render(<WatchFolderSettings />);

    expect(await screen.findByText(/marked missing/)).toBeInTheDocument();
  });
});
