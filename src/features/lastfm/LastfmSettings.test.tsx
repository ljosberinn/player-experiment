import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LastfmSettings } from "./LastfmSettings";
import { useLastfmStore } from "./store";

vi.mock("../../ipc", () => ({
  lastfmStatus: vi.fn(async () => ({ configured: true, username: null, queued: 0, import: null })),
  lastfmBeginConnect: vi.fn(),
  lastfmCompleteConnect: vi.fn(),
  lastfmDisconnect: vi.fn(async () => undefined),
  onLastfmDisconnected: vi.fn(async () => () => {}),
  onLastfmQueued: vi.fn(async () => () => {}),
  onLastfmImport: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));

function set(state: Partial<ReturnType<typeof useLastfmStore.getState>>) {
  useLastfmStore.setState({
    configured: true,
    username: null,
    connecting: false,
    queued: 0,
    error: null,
    imported: null,
    importing: false,
    importProgress: null,
    ...state,
  });
}

describe("the last.fm settings pane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    set({});
  });

  it("offers to connect when nothing is connected", () => {
    render(<LastfmSettings />);

    expect(screen.getByText("Not connected. Nothing is sent.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("says a build with no key cannot connect, rather than offering a button that can only fail", () => {
    set({ configured: false });
    render(<LastfmSettings />);

    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("names the account it is connected to, and offers the way out", () => {
    set({ username: "listener" });
    render(<LastfmSettings />);

    expect(screen.getByText("Connected as listener.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument();
  });

  it("points at the browser while a trip is in progress, and offers to stop", async () => {
    const user = userEvent.setup();
    const cancelConnect = vi.fn();
    set({ connecting: true });
    useLastfmStore.setState({ cancelConnect });
    render(<LastfmSettings />);

    expect(screen.getByText(/allow access in your browser/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(cancelConnect).toHaveBeenCalled();
  });

  it("says nothing about a backlog when there is none", () => {
    render(<LastfmSettings />);
    expect(screen.queryByText(/waiting to be sent/)).not.toBeInTheDocument();
  });

  it("counts the plays that have not gone out yet", () => {
    set({ username: "listener", queued: 4 });
    render(<LastfmSettings />);

    expect(screen.getByText(/^4 plays\b/)).toBeInTheDocument();
  });

  it("counts one play as one", () => {
    set({ username: "listener", queued: 1 });
    render(<LastfmSettings />);

    expect(screen.getByText(/^1 play\b/)).toBeInTheDocument();
  });

  it("shows a failure where the user is looking", () => {
    set({ error: "could not reach last.fm" });
    render(<LastfmSettings />);

    expect(screen.getByRole("alert")).toHaveTextContent("could not reach last.fm");
  });

  describe("importing a history", () => {
    it("imports the connected account's history", async () => {
      const user = userEvent.setup();
      const importHistory = vi.fn(async () => {});
      set({ username: "listener" });
      useLastfmStore.setState({ importHistory });
      render(<LastfmSettings />);

      expect(screen.getByLabelText("Import History")).toHaveValue("listener");
      await user.click(screen.getByRole("button", { name: "Import" }));

      expect(importHistory).toHaveBeenCalledWith("listener", false);
    });

    it("takes any username, connected or not", async () => {
      const user = userEvent.setup();
      const importHistory = vi.fn(async () => {});
      useLastfmStore.setState({ importHistory });
      render(<LastfmSettings />);

      expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
      await user.type(screen.getByLabelText("Import History"), " someone ");
      await user.click(screen.getByRole("button", { name: "Import" }));

      expect(importHistory).toHaveBeenCalledWith("someone", false);
    });

    it("offers to resume a run that stopped part-way", () => {
      set({ imported: { username: "listener", through: null, resumable: true } });
      render(<LastfmSettings />);

      expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();
    });

    it("says how far a finished import reached, and offers to start over", async () => {
      const user = userEvent.setup();
      const importHistory = vi.fn(async () => {});
      set({ imported: { username: "listener", through: 1_700_000_000, resumable: false } });
      useLastfmStore.setState({ importHistory });
      render(<LastfmSettings />);

      expect(screen.getByText(/Imported through/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Re-import from Scratch" }));

      expect(importHistory).toHaveBeenCalledWith("listener", true);
    });

    it("counts while it runs, and cannot be started twice", () => {
      set({
        username: "listener",
        imported: { username: "listener", through: 1_700_000_000, resumable: false },
        importing: true,
        importProgress: { done: 400, total: 237_572 },
      });
      render(<LastfmSettings />);

      expect(
        screen.getByText(`Importing 400 of ${(237_572).toLocaleString()} scrobbles…`),
      ).toBeInTheDocument();
      expect(document.querySelector(".progress-fill")).toHaveStyle({
        width: `${(400 / 237_572) * 100}%`,
      });
      expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Re-import from Scratch" })).toBeNull();
    });

    it("draws an empty rail before the first page arrives", () => {
      set({ importing: true, importProgress: null });
      render(<LastfmSettings />);

      expect(screen.getByText("Importing…")).toBeInTheDocument();
      expect(document.querySelector(".progress-fill")).toHaveStyle({ width: "0%" });
    });

    it("cannot import in a build with no key", () => {
      set({ configured: false, username: "listener" });
      render(<LastfmSettings />);

      expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    });
  });
});
