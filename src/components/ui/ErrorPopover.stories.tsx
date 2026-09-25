import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import { LIBRARY } from "../../../.storybook/fixtures";
import { Button } from "../primitives/Button";
import { ErrorPopover } from "./ErrorPopover";
import { NowPlaying } from "./NowPlaying";

/**
 * The popover pointing at what is playing, in a player bar at the foot of the
 * canvas, which is where the app anchors it.
 *
 * Live: a click anywhere else or Escape dismisses it, which is the `null`
 * state, and the button raises it again.
 */
function Anchored({ message }: { message: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<string | null>(message);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
        <Button onClick={() => setShown(message)}>Show the error</Button>
      </div>
      <div className="player-bar">
        <div className="player-bar-left">
          <NowPlaying track={LIBRARY[0] ?? null} ref={anchor} />
        </div>
      </div>
      <ErrorPopover message={shown} anchor={anchor} onDismiss={() => setShown(null)} />
    </div>
  );
}

const meta = {
  title: "UI/ErrorPopover",
  component: Anchored,
} satisfies Meta<typeof Anchored>;

export default meta;

export const Short: StoryObj<typeof meta> = {
  args: { message: "The audio device went away." },
};

/** A path and a reason, which is what most of them are. */
export const Long: StoryObj<typeof meta> = {
  args: {
    message:
      "C:\\Music\\Orchard Ensemble\\Field Recordings, Vol. 2\\01 Morning in the Orchard, Before Anyone Else Had Woken and the Frost Was Still on the Grass.flac could not be opened: The system cannot find the path specified. (os error 3)",
  },
};
