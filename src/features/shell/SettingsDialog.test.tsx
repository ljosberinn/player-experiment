import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadUnattendedLookup, revealMainLog } from "../../ipc";
import { useDynamicBackgroundStore } from "./dynamicBackgroundStore";
import { useLookupStore } from "./lookupStore";
import { SettingsDialog } from "./SettingsDialog";
import { useStatusStore } from "./statusStore";

vi.mock("../../ipc", () => ({
  loadDynamicBackground: vi.fn(async () => true),
  saveDynamicBackground: vi.fn(async () => undefined),
  loadZoom: vi.fn(async () => null),
  saveZoom: vi.fn(async () => undefined),
  listWatchFolders: vi.fn(async () => []),
  loadWatchInterval: vi.fn(async () => 15),
  removeWatchFolder: vi.fn(async () => undefined),
  saveWatchInterval: vi.fn(async () => undefined),
  revealMainLog: vi.fn(async () => undefined),
  loadUnattendedLookup: vi.fn(async () => false),
  saveUnattendedLookup: vi.fn(async () => undefined),
  loadLibraryFolder: vi.fn(async () => ({ root: null, organize: false })),
  saveOrganizeLibrary: vi.fn(async () => undefined),
  setLibraryRoot: vi.fn(async () => undefined),
  countTracks: vi.fn(async () => 0),
  defaultTrackQuery: {},
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

function checkbox(): HTMLInputElement {
  return screen.getByRole("checkbox", { name: "Colour From Album Art" });
}

describe("the Settings dialog", () => {
  beforeEach(() => {
    useDynamicBackgroundStore.setState({ enabled: true });
    useLookupStore.setState({ enabled: false });
  });

  it("shows the background switch in the state the store is in", () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    expect(checkbox()).toBeChecked();
  });

  it("turns the background off, and the store with it", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog onClose={vi.fn()} />);

    await user.click(checkbox());

    expect(useDynamicBackgroundStore.getState().enabled).toBe(false);
    expect(checkbox()).not.toBeChecked();
  });

  it("reflects a background that is already off", () => {
    useDynamicBackgroundStore.setState({ enabled: false });
    render(<SettingsDialog onClose={vi.fn()} />);

    // The dialog reads the store rather than holding its own copy: it can be
    // opened, closed and reopened, and the second time has to agree with the
    // first.
    expect(checkbox()).not.toBeChecked();
  });

  it("still carries the interface zoom", () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    // Phase 39 added a second row to a dialog that had one. Asserting the
    // first one is still there is what makes that an addition rather than a
    // replacement.
    expect(screen.getByText("Interface Zoom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
  });

  it("opens the activity log in the file manager", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Show Log File" }));

    expect(vi.mocked(revealMainLog)).toHaveBeenCalled();
  });

  it("reports a file manager that would not open, rather than failing silently", async () => {
    vi.mocked(revealMainLog).mockRejectedValueOnce(new Error("no file manager"));
    const user = userEvent.setup();
    render(<SettingsDialog onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Show Log File" }));

    expect(useStatusStore.getState().message).toContain("no file manager");
  });

  it("carries the music folders section", () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    // The dialog is where the watch folders became visible at all - the same
    // argument as the row above, one section later.
    expect(screen.getByText("Music Folders")).toBeInTheDocument();
    expect(screen.getByLabelText("Check For Changes")).toBeInTheDocument();
  });

  it("carries the library folder section, above the music folders", () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    // Above, because it is the stronger statement of the same thing: what the
    // app does to the library while nobody is watching.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings.indexOf("Library Folder")).toBeLessThan(headings.indexOf("Music Folders"));
    expect(screen.getByLabelText("Organise My Library")).toBeInTheDocument();
  });

  it("opts the library into looking releases up online", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog onClose={vi.fn()} />);
    const lookup = screen.getByRole("checkbox", { name: "Look Up Releases Online" });

    expect(lookup).not.toBeChecked();
    await user.click(lookup);

    expect(useLookupStore.getState().enabled).toBe(true);
    expect(lookup).toBeChecked();
  });

  it("reads the stored preference when it opens", async () => {
    vi.mocked(loadUnattendedLookup).mockResolvedValueOnce(true);
    render(<SettingsDialog onClose={vi.fn()} />);

    // Loaded on open rather than at startup: nothing outside this dialog
    // draws from it.
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Look Up Releases Online" })).toBeChecked();
    });
  });
});
