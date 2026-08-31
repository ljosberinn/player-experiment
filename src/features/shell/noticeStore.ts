import { create } from "zustand";

/**
 * The shell's own transient message.
 *
 * A store rather than state in `App` for the same reason the menu bar became a
 * component: held at the top, the message that says an export finished
 * re-rendered the whole app - the song table included - twice, once as it
 * appeared and once as it timed out. It is shown beside the playlist and tag
 * notices, by whoever is showing those.
 *
 * Shell-owned because the actions behind it are the shell's: an export started
 * from a menu, and a removal confirmed in a dialog. Neither belongs to the
 * library or to a playlist.
 */
type NoticeState = {
  notice: string | null;
  show: (notice: string) => void;
  dismiss: () => void;
};

export const useNoticeStore = create<NoticeState>((set) => ({
  notice: null,
  show: (notice) => set({ notice }),
  dismiss: () => set({ notice: null }),
}));
