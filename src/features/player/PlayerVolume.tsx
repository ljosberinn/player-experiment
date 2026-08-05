import { VolumeControl } from "../../components/ui/VolumeControl";
import { usePlayerStore } from "./store";

/**
 * The volume rail, subscribed to the player on its own behalf.
 *
 * This is the reason it is a component rather than four lines in `App`. The
 * rail reports with `onValueChange` rather than `onValueCommitted` -
 * deliberately, because volume has to follow the drag to be usable - so it
 * writes to the store on every pointer move. Read from the top of `App`, one
 * volume drag therefore re-rendered the entire song table at the pointer's
 * sampling rate, which is worse than the playhead's four times a second.
 */
export function PlayerVolume() {
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);

  return <VolumeControl volume={volume} onVolumeChange={(value) => void setVolume(value)} />;
}
