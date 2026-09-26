import type { Meta, StoryObj } from "@storybook/react-vite";
import { LIBRARY } from "../../../.storybook/fixtures";
import { playerHandlers } from "../../../.storybook/handlers";
import type { Track } from "../../ipc";
import { useLovedStore } from "../love/store";
import { PlayerBar } from "./PlayerBar";
import { usePlayerStore } from "./store";

function byId(id: number): Track {
  return LIBRARY.find((entry) => entry.id === id) as Track;
}

/** The player bar pinned to the foot of the window, as `App` places it. */
function Bar() {
  return (
    <div className="app">
      <div style={{ flex: 1 }} />
      <PlayerBar />
    </div>
  );
}

function playing(track: Track, status: "playing" | "paused", positionMs: number) {
  usePlayerStore.setState({
    status,
    track,
    positionMs,
    durationMs: track.duration_ms ?? 0,
  });
}

const meta = {
  title: "Features/Player/PlayerBar",
  component: Bar,
  parameters: { ipc: playerHandlers },
} satisfies Meta<typeof Bar>;

export default meta;

/** A loved song, a third of the way in. */
export const Playing: StoryObj<typeof meta> = {
  beforeEach: () => {
    const track = byId(1);
    playing(track, "playing", Math.round((track.duration_ms ?? 0) / 3));
    useLovedStore.setState({ loved: new Set([track.id]) });
  },
};

/** No artwork, and a title the column has to cut. */
export const PausedWithoutCover: StoryObj<typeof meta> = {
  beforeEach: () => {
    playing({ ...byId(201), cover_hash: null }, "paused", 42_000);
  },
};

export const MutedOnRepeat: StoryObj<typeof meta> = {
  beforeEach: () => {
    playing(byId(102), "playing", 12_000);
    usePlayerStore.setState({ muted: true, repeatOne: true });
  },
};
