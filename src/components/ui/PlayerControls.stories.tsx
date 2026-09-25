import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { RepeatButton } from "./RepeatButton";
import { Scrubber } from "./Scrubber";
import { Transport } from "./Transport";
import { VolumeControl } from "./VolumeControl";

const LENGTH = 214_000;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "contents" }}>
      <div style={{ color: "var(--muted)", fontSize: 11.5 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );
}

function LiveTransport({ from }: { from: boolean }) {
  const [playing, setPlaying] = useState(from);
  return (
    <Transport
      playing={playing}
      onPrevious={() => {}}
      onPlayPause={() => setPlaying(!playing)}
      onNext={() => {}}
    />
  );
}

function LiveScrubber({ from, durationMs }: { from: number; durationMs: number }) {
  const [position, setPosition] = useState(from);
  return (
    // The width of the bar's centre column at the window's minimum.
    <div style={{ width: 420 }}>
      <Scrubber positionMs={position} durationMs={durationMs} onSeek={setPosition} />
    </div>
  );
}

function LiveVolume({ from, muted: mutedFrom = false }: { from: number; muted?: boolean }) {
  const [volume, setVolume] = useState(from);
  const [muted, setMuted] = useState(mutedFrom);
  return (
    <VolumeControl
      volume={volume}
      muted={muted}
      onVolumeChange={setVolume}
      onToggleMute={() => setMuted(!muted)}
    />
  );
}

function LiveRepeat({ from }: { from: boolean }) {
  const [repeating, setRepeating] = useState(from);
  return <RepeatButton repeating={repeating} onToggle={() => setRepeating(!repeating)} />;
}

/**
 * The player bar's controls, each live from the state it starts in. The bar
 * that lays them out with a real player behind them is `Features/Player`.
 */
function Controls() {
  return (
    <div
      style={{
        padding: 24,
        display: "grid",
        gridTemplateColumns: "max-content 1fr",
        alignItems: "center",
        gap: "28px 24px",
      }}
    >
      <Row label="Transport: paused, playing">
        <LiveTransport from={false} />
        <LiveTransport from={true} />
      </Row>
      <Row label="Scrubber: start">
        <LiveScrubber from={0} durationMs={LENGTH} />
      </Row>
      <Row label="middle">
        <LiveScrubber from={LENGTH / 2} durationMs={LENGTH} />
      </Row>
      <Row label="end">
        <LiveScrubber from={LENGTH} durationMs={LENGTH} />
      </Row>
      <Row label="no duration">
        <LiveScrubber from={0} durationMs={0} />
      </Row>
      <Row label="Volume: 0, muted, full">
        <LiveVolume from={0} />
        <LiveVolume from={0.6} muted />
        <LiveVolume from={1} />
      </Row>
      <Row label="Repeat: off, on">
        <LiveRepeat from={false} />
        <LiveRepeat from={true} />
      </Row>
    </div>
  );
}

const meta = {
  title: "UI/Player controls",
  component: Controls,
} satisfies Meta<typeof Controls>;

export default meta;

export const State: StoryObj<typeof meta> = {};
