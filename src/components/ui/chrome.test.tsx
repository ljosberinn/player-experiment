import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VOLUME_STEP } from "../../features/player/shortcuts";
import type { Track } from "../../ipc";
import { coverUrl } from "../../ipc";
import { LibraryNav } from "./LibraryNav";
import { NowPlaying } from "./NowPlaying";
import { RepeatButton } from "./RepeatButton";
import { Scrubber } from "./Scrubber";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { Transport } from "./Transport";
import { VolumeControl } from "./VolumeControl";

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
    render(<Transport />);

    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("shows a pause affordance while playing", () => {
    render(<Transport playing onPlayPause={() => {}} />);

    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
  });
});

describe("VolumeControl", () => {
  it("reports volume as a 0..1 fraction", () => {
    const onVolumeChange = vi.fn();
    render(<VolumeControl volume={0.5} onVolumeChange={onVolumeChange} />);

    const slider = screen.getByRole("slider", { name: "Volume" });
    expect(slider).toHaveValue("50");

    // A slider is dragged, not typed into; fireEvent.change is how Testing
    // Library models that.
    fireEvent.change(slider, { target: { value: "60" } });

    expect(onVolumeChange).toHaveBeenCalledWith(0.6);
  });

  it("keeps showing the level while muted", async () => {
    // Not zero. The rail is what unmuting comes back to, and a slider that
    // dropped to the floor on mute would have thrown that away on screen even
    // though the backend still holds it.
    const onToggleMute = vi.fn();
    const user = userEvent.setup();
    render(
      <VolumeControl volume={0.4} muted onVolumeChange={() => {}} onToggleMute={onToggleMute} />,
    );

    expect(screen.getByRole("slider", { name: "Volume" })).toHaveValue("40");

    const button = screen.getByRole("button", { name: "Unmute" });
    expect(button).toHaveAttribute("aria-pressed", "true");

    await user.click(button);
    expect(onToggleMute).toHaveBeenCalledOnce();
  });

  it("offers to mute while audible", () => {
    render(<VolumeControl volume={0.4} onVolumeChange={() => {}} onToggleMute={() => {}} />);

    const button = screen.getByRole("button", { name: "Mute" });
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("disables the mute button when there is nothing to toggle it", () => {
    render(<VolumeControl volume={0.4} onVolumeChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Mute" })).toBeDisabled();
  });

  it("moves the volume a step per wheel notch over the rail", () => {
    const onVolumeChange = vi.fn();
    const { container } = render(
      <VolumeControl volume={0.5} onVolumeChange={onVolumeChange} onToggleMute={() => {}} />,
    );
    const rail = container.querySelector(".volume");
    if (rail === null) {
      throw new Error("no volume wrapper to scroll over");
    }

    fireEvent.wheel(rail, { deltaY: -100 });
    expect(onVolumeChange).toHaveBeenLastCalledWith(0.5 + VOLUME_STEP);

    fireEvent.wheel(rail, { deltaY: 100 });
    expect(onVolumeChange).toHaveBeenLastCalledWith(0.5 - VOLUME_STEP);
  });

  it("keeps the wheel inside the rail's range", () => {
    const onVolumeChange = vi.fn();
    const { container, rerender } = render(
      <VolumeControl volume={1} onVolumeChange={onVolumeChange} onToggleMute={() => {}} />,
    );
    const rail = container.querySelector(".volume");
    if (rail === null) {
      throw new Error("no volume wrapper to scroll over");
    }

    fireEvent.wheel(rail, { deltaY: -100 });
    expect(onVolumeChange).toHaveBeenLastCalledWith(1);

    rerender(<VolumeControl volume={0} onVolumeChange={onVolumeChange} onToggleMute={() => {}} />);
    fireEvent.wheel(rail, { deltaY: 100 });
    expect(onVolumeChange).toHaveBeenLastCalledWith(0);
  });

  it("ignores a horizontal wheel, which is not a volume gesture", () => {
    const onVolumeChange = vi.fn();
    const { container } = render(
      <VolumeControl volume={0.5} onVolumeChange={onVolumeChange} onToggleMute={() => {}} />,
    );
    const rail = container.querySelector(".volume");
    if (rail === null) {
      throw new Error("no volume wrapper to scroll over");
    }

    fireEvent.wheel(rail, { deltaY: 0, deltaX: -100 });

    expect(onVolumeChange).not.toHaveBeenCalled();
  });
});

describe("RepeatButton", () => {
  it("says whether it is on, rather than changing its name", async () => {
    // One control in two states: the label stays "Repeat one" and the pressed
    // state carries the difference, which is what a screen reader announces.
    const onToggle = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<RepeatButton onToggle={onToggle} />);

    const button = screen.getByRole("button", { name: "Repeat one" });
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(<RepeatButton repeating onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: "Repeat one" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("disables itself without a handler", () => {
    render(<RepeatButton />);

    expect(screen.getByRole("button", { name: "Repeat one" })).toBeDisabled();
  });
});

describe("Scrubber", () => {
  it("reads elapsed on the left and the track's length on the right", () => {
    // The right-hand figure is the total, not the time remaining. The design
    // shows a duration there and so does the Time column, and two readings of
    // the same song that disagree is worse to have on screen than a countdown
    // is good to have.
    render(<Scrubber positionMs={60_000} durationMs={208_000} />);

    expect(screen.getByText("1:00")).toBeInTheDocument();
    expect(screen.getByText("3:28")).toBeInTheDocument();
  });

  it("reports seeks in milliseconds", () => {
    const onSeek = vi.fn();
    render(<Scrubber positionMs={60_000} durationMs={208_000} onSeek={onSeek} />);

    const scrubber = screen.getByRole("slider", { name: "Seek" });
    expect(scrubber).toHaveValue("60000");

    fireEvent.change(scrubber, { target: { value: "90000" } });
    expect(onSeek).toHaveBeenCalledWith(90_000);
  });

  it("disables itself when there is nothing to seek through", () => {
    render(<Scrubber onSeek={() => {}} />);

    expect(screen.getByRole("slider", { name: "Seek" })).toBeDisabled();
  });

  it("never shows a position past the end of the track", () => {
    render(<Scrubber positionMs={999_000} durationMs={208_000} onSeek={() => {}} />);

    // Both readings are the length: clamped, not 16:39 against a 3:28 track.
    expect(screen.getAllByText("3:28")).toHaveLength(2);
  });
});

describe("NowPlaying", () => {
  it("is hidden rather than absent when nothing is playing", () => {
    // Hidden, not removed. It is the widest thing on the strip, and a box that
    // arrived with the first song would shove the volume and the search field
    // sideways at the moment of pressing play.
    render(<NowPlaying track={null} />);

    expect(screen.getByText("Nothing playing")).not.toBeVisible();
    expect(screen.getByTestId("now-playing")).toBeInTheDocument();
  });

  it("reveals what is playing on a double-click, and only when there is one", async () => {
    const onReveal = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<NowPlaying track={null} onReveal={onReveal} />);

    await user.dblClick(screen.getByTestId("now-playing"));
    expect(onReveal).not.toHaveBeenCalled();

    rerender(<NowPlaying track={track()} onReveal={onReveal} />);
    await user.dblClick(screen.getByTestId("now-playing"));

    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("shows title, artist and album for the current track", () => {
    render(<NowPlaying track={track()} />);

    expect(screen.getByText("Maki")).toBeInTheDocument();
    expect(screen.getByText("Guitar — Tokyo")).toBeInTheDocument();
  });

  it("falls back to the file name when a track has no title", () => {
    render(<NowPlaying track={track({ title: null })} />);

    expect(screen.getByText("01 Maki.mp3")).toBeInTheDocument();
  });

  it("requests cover art through the protocol helper", () => {
    render(<NowPlaying track={track({ cover_hash: "abc" })} />);

    expect(coverUrl).toHaveBeenCalledWith("abc");
    expect(screen.getByRole("presentation", { hidden: true })).toHaveAttribute(
      "src",
      "cover-url:abc",
    );
  });
});

describe("LibraryNav", () => {
  it("marks the open view", () => {
    render(<LibraryNav active="albums" onSelect={() => {}} />);

    expect(screen.getByRole("button", { name: "Albums" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Songs" })).not.toHaveAttribute("aria-current");
  });

  it("marks nothing while a playlist is open", () => {
    // Two highlighted rows in one sidebar would be two answers to the question
    // of what the content pane is showing.
    render(<LibraryNav active={null} onSelect={() => {}} />);

    for (const name of ["Songs", "Albums", "Artists", "Genres"]) {
      expect(screen.getByRole("button", { name })).not.toHaveAttribute("aria-current");
    }
  });

  it("offers all four views, none of them disabled", async () => {
    // They were disabled with a "Not implemented yet" tooltip from phase 3
    // until phase 19; three quarters of the primary navigation being dead is
    // the kind of thing a test should notice coming back.
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<LibraryNav active="songs" onSelect={onSelect} />);

    for (const name of ["Songs", "Albums", "Artists", "Genres"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }

    await user.click(screen.getByRole("button", { name: "Genres" }));
    expect(onSelect).toHaveBeenCalledWith("genres");
  });

  it("shows Statistics as a placeholder that cannot be opened", () => {
    // The design draws it, and it does nothing yet. Shown and unopenable rather
    // than hidden: a sidebar that grows an entry later moves every playlist
    // below it down the day it arrives.
    render(<LibraryNav active="songs" onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Statistics" })).toBeDisabled();
  });
});

describe("Sidebar", () => {
  it("is a labelled landmark holding whatever the shell puts in it", () => {
    // Chrome only since phase 35 - everything inside owns its own behaviour.
    render(
      <Sidebar>
        <p>Sources</p>
      </Sidebar>,
    );

    expect(screen.getByRole("navigation", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByText("Sources")).toBeInTheDocument();
  });
});
