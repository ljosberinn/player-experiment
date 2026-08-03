import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../../ipc";
import { coverUrl } from "../../ipc";
import { Sidebar } from "./Sidebar";
import { StatusDisplay } from "./StatusDisplay";
import { TabBar } from "./TabBar";
import { TitleBar } from "./TitleBar";
import { Transport } from "./Transport";

const minimize = vi.fn();
const toggleMaximize = vi.fn();
const close = vi.fn();
const startDragging = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize, toggleMaximize, close, startDragging }),
}));
vi.mock("../../ipc", () => ({ coverUrl: vi.fn((hash: string) => `cover-url:${hash}`) }));

beforeEach(() => {
  vi.clearAllMocks();
});

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    path: "D:/Music/Guitar/Tokyo/01 Maki.mp3",
    duration_ms: 208_000,
    title: "Maki",
    artist: "Guitar",
    album: "Tokyo",
    album_artist: null,
    genre: null,
    year: null,
    track_no: null,
    disc_no: null,
    comment: null,
    bitrate: null,
    sample_rate: null,
    cover_hash: null,
    added_at: 0,
    play_count: 0,
    last_played_at: null,
    missing_since: null,
    ...overrides,
  };
}

describe("TitleBar", () => {
  it("drives the window controls, since there is no OS frame", async () => {
    const user = userEvent.setup();
    render(<TitleBar>chrome</TitleBar>);

    await user.click(screen.getByRole("button", { name: "Minimize" }));
    await user.click(screen.getByRole("button", { name: "Maximize" }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(minimize).toHaveBeenCalledOnce();
    expect(toggleMaximize).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("starts a window drag from the bar itself", async () => {
    const user = userEvent.setup();
    render(<TitleBar>chrome</TitleBar>);

    await user.pointer({ keys: "[MouseLeft>]", target: screen.getByTestId("titlebar") });

    expect(startDragging).toHaveBeenCalledOnce();
  });

  it("maximizes on a double click of the bar itself", async () => {
    const user = userEvent.setup();
    render(<TitleBar>chrome</TitleBar>);

    await user.dblClick(screen.getByTestId("titlebar"));

    // What every desktop title bar does, and the app did not.
    expect(toggleMaximize).toHaveBeenCalledOnce();
  });

  it("does not maximize on a single click", async () => {
    const user = userEvent.setup();
    render(<TitleBar>chrome</TitleBar>);

    await user.click(screen.getByTestId("titlebar"));

    expect(toggleMaximize).not.toHaveBeenCalled();
    expect(startDragging).toHaveBeenCalledOnce();
  });

  it("reads the double click off mousedown, not off dblclick", () => {
    render(<TitleBar>chrome</TitleBar>);
    const bar = screen.getByTestId("titlebar");

    // `startDragging` hands the drag loop to the OS, which swallows the mouseup
    // and the second click - so a `dblclick` event never arrives on a bar that
    // also drags, and an onDoubleClick handler would be dead code. This is the
    // regression: it shipped green because the test fired a synthetic dblclick,
    // which jsdom delivers happily and Windows does not.
    fireEvent.dblClick(bar);
    expect(toggleMaximize).not.toHaveBeenCalled();

    fireEvent.mouseDown(bar, { detail: 2 });
    expect(toggleMaximize).toHaveBeenCalledOnce();
  });

  it("does not maximize when the double click lands on a control", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar>
        <input aria-label="Search" />
      </TitleBar>,
    );

    // Double-clicking a text field selects a word; it must not also resize the
    // window out from under the user.
    await user.dblClick(screen.getByRole("textbox", { name: "Search" }));

    expect(toggleMaximize).not.toHaveBeenCalled();
  });

  it("does not drag when the press lands on a control inside the bar", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar>
        <button type="button">Inner</button>
      </TitleBar>,
    );

    await user.click(screen.getByRole("button", { name: "Inner" }));

    expect(startDragging).not.toHaveBeenCalled();
  });
});

describe("Transport", () => {
  it("disables controls that have no handler yet", () => {
    render(<Transport volume={0.5} onVolumeChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("reports volume as a 0..1 fraction", async () => {
    const onVolumeChange = vi.fn();
    render(<Transport volume={0.5} onVolumeChange={onVolumeChange} />);

    const slider = screen.getByRole("slider", { name: "Volume" });
    expect(slider).toHaveValue("50");

    // A range input is dragged, not typed into; fireEvent.change is how
    // Testing Library models that.
    fireEvent.change(slider, { target: { value: "60" } });

    expect(onVolumeChange).toHaveBeenCalledWith(0.6);
  });

  it("shows a pause affordance while playing", () => {
    render(<Transport playing volume={0.5} onPlayPause={() => {}} onVolumeChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
  });
});

describe("StatusDisplay", () => {
  it("shows the library summary when nothing is playing", () => {
    render(<StatusDisplay track={null} summary="237 songs, 19.2 hours" />);

    expect(screen.getByText("237 songs, 19.2 hours")).toBeInTheDocument();
  });

  it("shows title, artist and album for the current track", () => {
    render(<StatusDisplay track={track()} summary="" />);

    expect(screen.getByText("Maki")).toBeInTheDocument();
    expect(screen.getByText("Guitar — Tokyo")).toBeInTheDocument();
  });

  it("falls back to the file name when a track has no title", () => {
    render(<StatusDisplay track={track({ title: null })} summary="" />);

    expect(screen.getByText("01 Maki.mp3")).toBeInTheDocument();
  });

  it("counts remaining time down rather than up", () => {
    render(<StatusDisplay track={track()} positionMs={60_000} summary="" />);

    expect(screen.getByText("1:00")).toBeInTheDocument();
    expect(screen.getByText("-2:28")).toBeInTheDocument();
  });

  it("exposes a seekable scrubber that reports milliseconds", async () => {
    const onSeek = vi.fn();
    render(<StatusDisplay track={track()} positionMs={60_000} summary="" onSeek={onSeek} />);

    const scrubber = screen.getByRole("slider", { name: "Seek" });
    expect(scrubber).toHaveValue("60000");

    fireEvent.change(scrubber, { target: { value: "90000" } });
    expect(onSeek).toHaveBeenCalledWith(90_000);
  });

  it("disables the scrubber when there is nothing to seek through", () => {
    render(<StatusDisplay track={track({ duration_ms: 0 })} summary="" onSeek={() => {}} />);

    expect(screen.getByRole("slider", { name: "Seek" })).toBeDisabled();
  });

  it("never shows a position past the end of the track", () => {
    render(<StatusDisplay track={track()} positionMs={999_000} summary="" onSeek={() => {}} />);

    expect(screen.getByText("-0:00")).toBeInTheDocument();
  });

  it("requests cover art through the protocol helper", () => {
    render(<StatusDisplay track={track({ cover_hash: "abc" })} summary="" />);

    expect(coverUrl).toHaveBeenCalledWith("abc");
    expect(screen.getByRole("presentation", { hidden: true })).toHaveAttribute(
      "src",
      "cover-url:abc",
    );
  });
});

describe("TabBar", () => {
  it("marks the active tab", () => {
    render(<TabBar active="albums" onChange={() => {}} />);

    expect(screen.getByRole("tab", { name: "Albums" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Songs" })).toHaveAttribute("aria-selected", "false");
  });

  it("offers all four views, none of them disabled", async () => {
    // They were disabled with a "Not implemented yet" tooltip from phase 3
    // until phase 19; three quarters of the primary navigation being dead is
    // the kind of thing a test should notice coming back.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TabBar active="songs" onChange={onChange} />);

    for (const name of ["Songs", "Albums", "Artists", "Genres"]) {
      expect(screen.getByRole("tab", { name })).toBeEnabled();
    }

    await user.click(screen.getByRole("tab", { name: "Genres" }));
    expect(onChange).toHaveBeenCalledWith("genres");
  });
});

describe("Sidebar", () => {
  it("marks the selected source and reports changes", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <Sidebar
        sections={[
          {
            title: "Library",
            items: [
              { id: "music", label: "Music" },
              { id: "other", label: "Other" },
            ],
          },
        ]}
        selectedId="music"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole("button", { name: "Music" })).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: "Other" }));

    expect(onSelect).toHaveBeenCalledWith("other");
  });
});
