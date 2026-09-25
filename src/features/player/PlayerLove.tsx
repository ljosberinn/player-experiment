import { LoveButton } from "../../components/ui/LoveButton";
import { useLoveEntry } from "../love/loveEntry";
import { usePlayerStore } from "./store";

/**
 * The heart for what is playing, subscribed on its own behalf.
 *
 * Its own component because it reads the loved set: in `App`, every love would
 * re-render the song table with it.
 */
export function PlayerLove() {
  const track = usePlayerStore((s) => s.track);
  const loving = useLoveEntry(track === null ? [] : [track.id], () => track);

  if (loving === undefined) {
    return <LoveButton hidden />;
  }
  return (
    <LoveButton
      loved={loving.loved}
      hint={loving.keyed ? undefined : "No artist and title"}
      onToggle={() => loving.onToggle(!loving.loved)}
    />
  );
}
