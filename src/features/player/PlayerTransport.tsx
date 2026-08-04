import { Transport } from "../../components/ui/Transport";
import { usePlayerStore } from "./store";

/**
 * The transport controls, subscribed to the player on their own behalf.
 *
 * `volume` is the reason this is a component rather than six lines in `App`.
 * The volume slider reports with `onValueChange` rather than `onValueCommitted`
 * - deliberately, because volume has to follow the drag to be usable - so it
 * writes to the store on every pointer move. Read from the top of `App`, one
 * volume drag therefore re-rendered the entire song table at the pointer's
 * sampling rate, which is worse than the playhead's four times a second.
 */
export function PlayerTransport() {
  const status = usePlayerStore((s) => s.status);
  const volume = usePlayerStore((s) => s.volume);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const setVolume = usePlayerStore((s) => s.setVolume);

  return (
    <Transport
      playing={status === "playing"}
      volume={volume}
      onPrevious={() => void previous()}
      onPlayPause={() => void toggle()}
      onNext={() => void next()}
      onVolumeChange={(value) => void setVolume(value)}
    />
  );
}
