import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibraryStore } from "../../features/library/store";
import { VOLUME_STEP } from "../../features/player/shortcuts";
import { usePlaylistsStore } from "../../features/playlists/store";
import type { BuiltIn, Playlist, Track } from "../../ipc";
import { coverUrl } from "../../ipc";
import { AppBar } from "./AppBar";
import { LibraryNav } from "./LibraryNav";
import { NowPlaying } from "./NowPlaying";
import { RepeatButton } from "./RepeatButton";
import { Scrubber } from "./Scrubber";
import { Sidebar } from "./Sidebar";
import { Transport } from "./Transport";
import { VolumeControl } from "./VolumeControl";

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
    release_group_mbid: null,
    ...overrides,
  };
}

describe("AppBar", () => {
  it("carries the mark, the wordmark and the version", () => {
    render(<AppBar version="1.2.3">chrome</AppBar>);

    expect(screen.getByText("APEX")).toBeInTheDocument();
    expect(screen.getByText("v1.2.3")).toBeInTheDocument();
  });

  it("says nothing about a version it has not been given", () => {
    // `get_app_info` has not answered yet, which is a real state on every
    // launch. A bare "v" in the corner would be worse than an empty one.
    render(<AppBar>chrome</AppBar>);

    expect(screen.queryByText(/^v/)).not.toBeInTheDocument();
  });

  it("draws no window controls, since the OS frame has them", () => {
    // Phase 119 took `decorations: false` away. A minimise, maximise or close
    // button here would now be a second set beside the real ones.
    render(<AppBar version="1.2.3">chrome</AppBar>);

    expect(screen.queryAllByRole("button")).toEqual([]);
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

    expect(screen.getByRole("button", { name: "Releases" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Songs" })).not.toHaveAttribute("aria-current");
  });

  it("marks nothing while a playlist is open", () => {
    // Two highlighted rows in one sidebar would be two answers to the question
    // of what the content pane is showing.
    render(<LibraryNav active={null} onSelect={() => {}} />);

    for (const name of ["Songs", "Releases", "Artists", "Genres", "Statistics"]) {
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

    for (const name of ["Songs", "Releases", "Artists", "Genres", "Statistics"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }

    await user.click(screen.getByRole("button", { name: "Genres" }));
    expect(onSelect).toHaveBeenCalledWith("genres");
  });

  it("opens Statistics like any other view", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<LibraryNav active="songs" onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: "Statistics" }));
    expect(onSelect).toHaveBeenCalledWith("stats");
  });

  describe("with the built-ins", () => {
    const builtIn = (id: number, name: string, key: BuiltIn): Playlist => ({
      id,
      name,
      kind: "smart",
      trackCount: 3,
      createdAt: 0,
      builtIn: key,
    });
    const initialLibrary = useLibraryStore.getState();

    beforeEach(() => {
      usePlaylistsStore.setState({
        playlists: [
          builtIn(3, "Recently Added", "recentlyAdded"),
          { id: 4, name: "Mix", kind: "static", trackCount: 3, createdAt: 0, builtIn: null },
          builtIn(2, "Most Played", "mostPlayed"),
          builtIn(1, "Favorites", "favorites"),
        ],
      });
      useLibraryStore.setState({ ...initialLibrary, playlistId: 2, showPlaylist: vi.fn() });
    });

    it("draws them under Statistics, in a fixed order", () => {
      render(<LibraryNav active={null} onSelect={() => {}} />);

      const names = screen.getAllByRole("button").map((button) => button.textContent);
      expect(names.slice(4)).toEqual(["Statistics", "Favorites", "Most Played", "Recently Added"]);
    });

    it("marks the open one and opens the one clicked", async () => {
      const user = userEvent.setup();
      render(<LibraryNav active={null} onSelect={() => {}} />);

      expect(screen.getByRole("button", { name: "Most Played" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await user.click(screen.getByRole("button", { name: "Favorites" }));
      expect(useLibraryStore.getState().showPlaylist).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
      );
    });

    it("offers Play and Export only", async () => {
      render(<LibraryNav active={null} onSelect={() => {}} />);

      fireEvent.contextMenu(screen.getByRole("button", { name: "Favorites" }));

      const items = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
      expect(items).toEqual(["Play", "Export…"]);
    });
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

  describe("the keyboard across its sections", () => {
    /** Two sections of rows, the way the real sidebar stacks them. */
    function sources(current = "Releases") {
      return (
        <Sidebar>
          <div className="sidebar-section">
            <button type="button" className="sidebar-fold">
              Library
            </button>
            <ul>
              {["Songs", "Releases"].map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className="sidebar-item"
                    aria-current={name === current ? "page" : undefined}
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="sidebar-section">
            <ul>
              <li>
                <button type="button" className="sidebar-item">
                  Party
                </button>
              </li>
            </ul>
          </div>
        </Sidebar>
      );
    }

    const row = (name: string) => screen.getByRole("button", { name });

    it("gives the whole sidebar one tab stop, on the open source", () => {
      render(sources());

      expect(row("Releases")).toHaveAttribute("tabindex", "0");
      expect(row("Songs")).toHaveAttribute("tabindex", "-1");
      expect(row("Party")).toHaveAttribute("tabindex", "-1");
    });

    it("leaves the headings' own controls tabbable", () => {
      render(sources());

      // A fold is a control, not a place to go, and the arrows do not walk it.
      expect(row("Library")).not.toHaveAttribute("tabindex", "-1");
    });

    it("walks every section with the arrows, not one section at a time", async () => {
      render(sources());
      row("Releases").focus();

      await userEvent.keyboard("{ArrowDown}");

      // Across the section boundary: `LibraryNav` chose buttons over a tablist
      // precisely so the arrows could leave the library views behind.
      expect(row("Party")).toHaveFocus();
    });

    it("goes back up again", async () => {
      render(sources());
      row("Party").focus();

      await userEvent.keyboard("{ArrowUp}");

      expect(row("Releases")).toHaveFocus();
    });

    it("claims the key at the ends, so it cannot reach the track list", async () => {
      render(sources());
      row("Party").focus();

      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        cancelable: true,
        bubbles: true,
      });
      row("Party").dispatchEvent(event);

      expect(row("Party")).toHaveFocus();
      expect(event.defaultPrevented).toBe(true);
    });

    it("moves focus without opening anything", async () => {
      const onSelect = vi.fn();
      render(
        <Sidebar>
          <button type="button" className="sidebar-item" aria-current="page" onClick={onSelect}>
            Songs
          </button>
          <button type="button" className="sidebar-item" onClick={onSelect}>
            Releases
          </button>
        </Sidebar>,
      );
      row("Songs").focus();

      // A sidebar that navigated per arrow would re-query the library on every
      // keypress; Enter and Space are what open a view.
      await userEvent.keyboard("{ArrowDown}");

      expect(row("Releases")).toHaveFocus();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("leaves the arrows to a rename field in the list", async () => {
      render(
        <Sidebar>
          <button type="button" className="sidebar-item" aria-current="page">
            Songs
          </button>
          <input aria-label="Rename" defaultValue="Party" />
        </Sidebar>,
      );
      screen.getByLabelText("Rename").focus();

      await userEvent.keyboard("{ArrowUp}");

      expect(screen.getByLabelText("Rename")).toHaveFocus();
    });

    it("follows rows that arrive after the first render", async () => {
      const { rerender } = render(
        <Sidebar>
          <button type="button" className="sidebar-item" aria-current="page">
            Songs
          </button>
        </Sidebar>,
      );

      // Playlists load, sections fold, the review queue appears once a pass
      // has queued something - none of it is there on the first render.
      rerender(
        <Sidebar>
          <button type="button" className="sidebar-item">
            Songs
          </button>
          <button type="button" className="sidebar-item" aria-current="page">
            Party
          </button>
        </Sidebar>,
      );

      await waitFor(() => expect(row("Party")).toHaveAttribute("tabindex", "0"));
      expect(row("Songs")).toHaveAttribute("tabindex", "-1");
    });
  });
});
