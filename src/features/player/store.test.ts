import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerPosition, PlayerSnapshot, Track } from "../../ipc";
import {
  onPlayerError,
  onPlayerPosition,
  onPlayerState,
  playerNext,
  playerPlay,
  playerPrevious,
  playerSeek,
  playerSetMuted,
  playerSetRepeatOne,
  playerSetVolume,
  playerSnapshot,
  playerStop,
  playerToggle,
} from "../../ipc";
import { usePlayerStore } from "./store";

vi.mock("../../ipc", () => ({
  onPlayerState: vi.fn(),
  onPlayerPosition: vi.fn(),
  onPlayerError: vi.fn(),
  playerPlay: vi.fn(),
  playerToggle: vi.fn(),
  playerStop: vi.fn(),
  playerNext: vi.fn(),
  playerPrevious: vi.fn(),
  playerSeek: vi.fn(),
  playerSetVolume: vi.fn(),
  playerSetMuted: vi.fn(),
  playerSetRepeatOne: vi.fn(),
  playerSnapshot: vi.fn(),
}));

function track(id: number, durationMs = 200_000): Track {
  return {
    id,
    path: `/m/${id}.mp3`,
    duration_ms: durationMs,
    title: `Track ${id}`,
    artist: "Artist",
    album: null,
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
  };
}

function snapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    status: "playing",
    track: track(1),
    queueIndex: 0,
    queueLen: 3,
    positionMs: 0,
    durationMs: 200_000,
    volume: 0.8,
    muted: false,
    repeatOne: false,
    ...overrides,
  };
}

/** Captures the handlers `connect` registers so tests can fire backend events. */
function captureListeners() {
  const handlers: {
    state?: (snapshot: PlayerSnapshot) => void;
    position?: (position: PlayerPosition) => void;
    error?: (message: string) => void;
  } = {};

  vi.mocked(onPlayerState).mockImplementation(async (handler) => {
    handlers.state = handler;
    return () => {};
  });
  vi.mocked(onPlayerPosition).mockImplementation(async (handler) => {
    handlers.position = handler;
    return () => {};
  });
  vi.mocked(onPlayerError).mockImplementation(async (handler) => {
    handlers.error = handler;
    return () => {};
  });
  return handlers;
}

beforeEach(() => {
  usePlayerStore.setState({
    status: "stopped",
    track: null,
    positionMs: 0,
    durationMs: 0,
    volume: 0.8,
    muted: false,
    repeatOne: false,
    queueIndex: null,
    queueLen: 0,
    error: null,
  });
  vi.mocked(playerSnapshot).mockResolvedValue(snapshot({ status: "stopped", track: null }));
  for (const command of [
    playerPlay,
    playerToggle,
    playerStop,
    playerNext,
    playerPrevious,
    playerSeek,
    playerSetVolume,
    playerSetMuted,
    playerSetRepeatOne,
  ]) {
    vi.mocked(command).mockResolvedValue(undefined);
  }
});

describe("connect", () => {
  it("adopts the snapshot the backend already has", async () => {
    captureListeners();
    vi.mocked(playerSnapshot).mockResolvedValue(
      snapshot({ status: "paused", positionMs: 42_000, volume: 0.3 }),
    );

    await usePlayerStore.getState().connect();

    const state = usePlayerStore.getState();
    expect(state.status).toBe("paused");
    expect(state.track?.id).toBe(1);
    expect(state.positionMs).toBe(42_000);
    expect(state.volume).toBe(0.3);
    expect(state.queueLen).toBe(3);
  });

  it("subscribes before asking for the snapshot, so no change is missed", async () => {
    const order: string[] = [];
    vi.mocked(onPlayerState).mockImplementation(async () => {
      order.push("listen");
      return () => {};
    });
    vi.mocked(onPlayerPosition).mockResolvedValue(() => {});
    vi.mocked(onPlayerError).mockResolvedValue(() => {});
    vi.mocked(playerSnapshot).mockImplementation(async () => {
      order.push("snapshot");
      return snapshot();
    });

    await usePlayerStore.getState().connect();
    expect(order).toEqual(["listen", "snapshot"]);
  });

  it("applies state events", async () => {
    const handlers = captureListeners();
    await usePlayerStore.getState().connect();

    handlers.state?.(snapshot({ status: "playing", track: track(7), positionMs: 1_000 }));

    const state = usePlayerStore.getState();
    expect(state.status).toBe("playing");
    expect(state.track?.id).toBe(7);
    expect(state.positionMs).toBe(1_000);
  });

  it("applies position ticks without touching the rest of the state", async () => {
    const handlers = captureListeners();
    await usePlayerStore.getState().connect();
    handlers.state?.(snapshot({ track: track(7) }));

    handlers.position?.({ positionMs: 90_000, durationMs: 200_000 });

    const state = usePlayerStore.getState();
    expect(state.positionMs).toBe(90_000);
    expect(state.track?.id).toBe(7);
    expect(state.status).toBe("playing");
  });

  it("surfaces backend errors", async () => {
    const handlers = captureListeners();
    await usePlayerStore.getState().connect();

    handlers.error?.("no audio output device");
    expect(usePlayerStore.getState().error).toBe("no audio output device");

    usePlayerStore.getState().dismissError();
    expect(usePlayerStore.getState().error).toBeNull();
  });

  it("reports a snapshot that fails rather than throwing at startup", async () => {
    captureListeners();
    vi.mocked(playerSnapshot).mockRejectedValue(new Error("no backend"));

    await usePlayerStore.getState().connect();
    expect(usePlayerStore.getState().error).toContain("no backend");
  });

  it("returns a teardown that removes every listener", async () => {
    const offs = [vi.fn(), vi.fn(), vi.fn()] as const;
    vi.mocked(onPlayerState).mockResolvedValue(offs[0]);
    vi.mocked(onPlayerPosition).mockResolvedValue(offs[1]);
    vi.mocked(onPlayerError).mockResolvedValue(offs[2]);

    const stop = await usePlayerStore.getState().connect();
    stop();

    for (const off of offs) {
      expect(off).toHaveBeenCalledOnce();
    }
  });
});

describe("commands", () => {
  it("forwards the queue and the starting index", async () => {
    await usePlayerStore.getState().play([5, 6, 7], 1);
    expect(playerPlay).toHaveBeenCalledWith([5, 6, 7], 1);
  });

  it.each([
    ["toggle", playerToggle],
    ["stop", playerStop],
    ["next", playerNext],
    ["previous", playerPrevious],
  ] as const)("forwards %s", async (name, command) => {
    await usePlayerStore.getState()[name]();
    expect(command).toHaveBeenCalledOnce();
  });

  it("does not flip state optimistically - the backend is the source of truth", async () => {
    await usePlayerStore.getState().toggle();
    expect(usePlayerStore.getState().status).toBe("stopped");
  });

  it("reports a command that fails instead of swallowing it", async () => {
    vi.mocked(playerToggle).mockRejectedValue(new Error("player thread is not running"));

    await usePlayerStore.getState().toggle();
    expect(usePlayerStore.getState().error).toContain("player thread is not running");
  });
});

describe("seek", () => {
  beforeEach(() => {
    usePlayerStore.setState({ durationMs: 100_000 });
  });

  it("echoes the new position so the scrubber does not lag the drag", async () => {
    await usePlayerStore.getState().seek(30_000);
    expect(usePlayerStore.getState().positionMs).toBe(30_000);
    expect(playerSeek).toHaveBeenCalledWith(30_000);
  });

  it("clamps its own echo to the track", async () => {
    await usePlayerStore.getState().seek(500_000);
    expect(usePlayerStore.getState().positionMs).toBe(100_000);

    await usePlayerStore.getState().seek(-10);
    expect(usePlayerStore.getState().positionMs).toBe(0);
  });
});

describe("setVolume", () => {
  it("clamps and forwards", async () => {
    await usePlayerStore.getState().setVolume(1.5);
    expect(usePlayerStore.getState().volume).toBe(1);
    expect(playerSetVolume).toHaveBeenCalledWith(1);

    await usePlayerStore.getState().setVolume(-0.5);
    expect(usePlayerStore.getState().volume).toBe(0);
    expect(playerSetVolume).toHaveBeenLastCalledWith(0);
  });

  it("lifts a mute in its echo, as the backend does", async () => {
    // Otherwise the fill follows the pointer under a lit mute button until the
    // state event lands - the one place the local echo could disagree with the
    // player it is echoing.
    usePlayerStore.setState({ muted: true });

    await usePlayerStore.getState().setVolume(0.6);

    expect(usePlayerStore.getState().muted).toBe(false);
  });
});

describe("mute and repeat", () => {
  it("asks for the opposite of what it currently has", async () => {
    await usePlayerStore.getState().toggleMute();
    expect(playerSetMuted).toHaveBeenCalledWith(true);

    usePlayerStore.setState({ muted: true });
    await usePlayerStore.getState().toggleMute();
    expect(playerSetMuted).toHaveBeenLastCalledWith(false);

    await usePlayerStore.getState().toggleRepeatOne();
    expect(playerSetRepeatOne).toHaveBeenCalledWith(true);
  });

  it("waits for the backend rather than flipping itself", async () => {
    // Same rule as play/pause: the player owns the state, and a button that
    // lit before the command landed would have to be un-lit if it failed.
    await usePlayerStore.getState().toggleMute();
    expect(usePlayerStore.getState().muted).toBe(false);

    await usePlayerStore.getState().toggleRepeatOne();
    expect(usePlayerStore.getState().repeatOne).toBe(false);
  });

  it("adopts both from a state event", async () => {
    const handlers = captureListeners();
    await usePlayerStore.getState().connect();

    handlers.state?.(snapshot({ muted: true, repeatOne: true, volume: 0.4 }));

    const state = usePlayerStore.getState();
    expect(state.muted).toBe(true);
    expect(state.repeatOne).toBe(true);
    // Muted is not a volume of zero: the rail still shows what comes back.
    expect(state.volume).toBe(0.4);
  });

  it("reports a failing toggle instead of swallowing it", async () => {
    vi.mocked(playerSetMuted).mockRejectedValue(new Error("the player thread is not running"));

    await usePlayerStore.getState().toggleMute();
    expect(usePlayerStore.getState().error).toContain("the player thread is not running");
  });
});
