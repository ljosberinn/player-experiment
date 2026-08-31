import type { RefObject } from "react";
import { ErrorPopover } from "../../components/ui/ErrorPopover";
import { useEditorStore } from "../editor/store";
import { useScanStore } from "../library/scan";
import { useLibraryStore } from "../library/store";
import { usePlayerStore } from "../player/store";
import { usePlaylistsStore } from "../playlists/store";

/**
 * The one error on screen, whichever part of the app it came from.
 *
 * Five stores can be unhappy at once and there is one place to say so, so the
 * order is the order they are noticed in - and dismissing clears all five
 * rather than uncovering the next one, which would read as the message
 * refusing to go away.
 */
export function AppErrorPopover({ anchor }: { anchor: RefObject<HTMLElement | null> }) {
  const libraryError = useLibraryStore((s) => s.error);
  const playerError = usePlayerStore((s) => s.error);
  const playlistError = usePlaylistsStore((s) => s.error);
  const tagError = useEditorStore((s) => s.error);
  const scanError = useScanStore((s) => s.error);

  const dismissLibraryError = useLibraryStore((s) => s.dismissError);
  const dismissPlayerError = usePlayerStore((s) => s.dismissError);
  const dismissPlaylistError = usePlaylistsStore((s) => s.dismissError);
  const dismissTagError = useEditorStore((s) => s.dismissError);
  const dismissScanError = useScanStore((s) => s.dismissError);

  return (
    <ErrorPopover
      message={libraryError ?? playerError ?? playlistError ?? tagError ?? scanError ?? null}
      anchor={anchor}
      onDismiss={() => {
        dismissLibraryError();
        dismissPlayerError();
        dismissPlaylistError();
        dismissTagError();
        dismissScanError();
      }}
    />
  );
}
