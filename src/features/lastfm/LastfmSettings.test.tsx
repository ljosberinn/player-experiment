import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LastfmSettings } from "./LastfmSettings";
import { useLastfmStore } from "./store";

vi.mock("../../ipc", () => ({
  lastfmStatus: vi.fn(async () => ({ configured: true, username: null, queued: 0 })),
  lastfmBeginConnect: vi.fn(),
  lastfmCompleteConnect: vi.fn(),
  lastfmDisconnect: vi.fn(async () => undefined),
  onLastfmDisconnected: vi.fn(async () => () => {}),
  onLastfmQueued: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));

function set(state: Partial<ReturnType<typeof useLastfmStore.getState>>) {
  useLastfmStore.setState({
    configured: true,
    username: null,
    connecting: false,
    queued: 0,
    error: null,
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

    expect(screen.getByText(/carries no last.fm key/)).toBeInTheDocument();
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

  it("says what leaves the machine, and what does not", () => {
    // The product judgement this whole pane exists for: a local-only player
    // gaining its first outbound dependency has to be explicit about it. If
    // this assertion is ever deleted, the paragraph goes with it.
    render(<LastfmSettings />);

    expect(screen.getByText(/nothing but an API key/)).toBeInTheDocument();
    expect(screen.getByText(/Never the file path/)).toBeInTheDocument();
    // And that the credential is not pretending to be protected.
    expect(screen.getByText(/stored unencrypted/)).toBeInTheDocument();
  });

  it("says nothing about a backlog when there is none", () => {
    render(<LastfmSettings />);
    expect(screen.queryByText(/waiting to be sent/)).not.toBeInTheDocument();
  });

  it("counts the plays that have not gone out yet", () => {
    set({ username: "listener", queued: 4 });
    render(<LastfmSettings />);

    expect(screen.getByText(/4 plays are recorded and waiting/)).toBeInTheDocument();
  });

  it("counts one play as one", () => {
    set({ username: "listener", queued: 1 });
    render(<LastfmSettings />);

    expect(screen.getByText(/1 play is recorded and waiting/)).toBeInTheDocument();
  });

  it("shows a failure where the user is looking", () => {
    set({ error: "could not reach last.fm" });
    render(<LastfmSettings />);

    expect(screen.getByRole("alert")).toHaveTextContent("could not reach last.fm");
  });
});
