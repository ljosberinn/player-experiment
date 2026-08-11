import { RepeatButton } from "../../components/ui/RepeatButton";
import { usePlayerStore } from "./store";

/**
 * The repeat-one toggle, subscribed to the player on its own behalf.
 *
 * Its own component for the reason the transport pill and the volume rail are:
 * everything on the strip that reads from the store reads it here rather than
 * in `App`, where one subscription re-renders the song table with it.
 */
export function PlayerRepeat() {
  const repeatOne = usePlayerStore((s) => s.repeatOne);
  const toggleRepeatOne = usePlayerStore((s) => s.toggleRepeatOne);

  return <RepeatButton repeating={repeatOne} onToggle={() => void toggleRepeatOne()} />;
}
