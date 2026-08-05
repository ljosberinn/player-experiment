import { Transport } from "../../components/ui/Transport";
import { usePlayerStore } from "./store";

/**
 * The prev / play / next pill, subscribed to the player on its own behalf.
 *
 * Reads only `status`, which changes when playback starts, stops or pauses -
 * a handful of times a song rather than continuously. The two controls that do
 * change continuously, the playhead and the volume rail, are their own
 * components for that reason.
 */
export function PlayerTransport() {
  const status = usePlayerStore((s) => s.status);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);

  return (
    <Transport
      playing={status === "playing"}
      onPrevious={() => void previous()}
      onPlayPause={() => void toggle()}
      onNext={() => void next()}
    />
  );
}
