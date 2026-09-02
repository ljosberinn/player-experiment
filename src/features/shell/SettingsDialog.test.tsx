import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDynamicBackgroundStore } from "./dynamicBackgroundStore";
import { SettingsDialog } from "./SettingsDialog";

vi.mock("../../ipc", () => ({
  loadDynamicBackground: vi.fn(async () => true),
  saveDynamicBackground: vi.fn(async () => undefined),
  loadZoom: vi.fn(async () => null),
  saveZoom: vi.fn(async () => undefined),
  listWatchFolders: vi.fn(async () => []),
  loadWatchInterval: vi.fn(async () => 15),
  removeWatchFolder: vi.fn(async () => undefined),
  saveWatchInterval: vi.fn(async () => undefined),
}));

function checkbox(): HTMLInputElement {
  return screen.getByRole("checkbox", { name: "Colour From Album Art" });
}

describe("the Settings dialog", () => {
  beforeEach(() => {
    useDynamicBackgroundStore.setState({ enabled: true });
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

  it("carries the music folders section", () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    // The dialog is where the watch folders became visible at all - the same
    // argument as the row above, one section later.
    expect(screen.getByText("Music Folders")).toBeInTheDocument();
    expect(screen.getByLabelText("Check For Changes")).toBeInTheDocument();
  });
});
