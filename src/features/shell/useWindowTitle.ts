import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { usePlayerStore } from "../player/store";
import { windowTitle } from "./windowTitle";

/**
 * Keeps the OS window title saying what is playing.
 *
 * Driven off the player store rather than set once from `tauri.conf.json`,
 * which states a fixed `Apex`. The window has no decorations, so the title is
 * invisible in the app itself and shows only in Alt+Tab and the taskbar -
 * which is exactly where a media player should be findable by its song.
 *
 * Subscribes to the title string alone: it is called from `App`, which must
 * not re-render for a playhead tick, a pause or a play count.
 */
export function useWindowTitle(): void {
  const title = usePlayerStore((s) => windowTitle(s.track));

  useEffect(() => {
    // Not awaited and not surfaced: a title that failed to change is not worth
    // an error banner over the library.
    void getCurrentWindow().setTitle(title);
  }, [title]);
}
