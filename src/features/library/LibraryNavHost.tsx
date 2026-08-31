import { LibraryNav } from "../../components/ui/LibraryNav";
import { useLibraryStore } from "./store";

/**
 * The library section of the sidebar, subscribed on its own behalf.
 *
 * Which view is current is a two-line question - the tab, unless a playlist is
 * open - and answering it at the top of `App` meant every navigation re-rendered
 * the title bar, the transport and the status bar to move one highlight.
 */
export function LibraryNavHost() {
  const tab = useLibraryStore((s) => s.tab);
  const showTab = useLibraryStore((s) => s.showTab);
  const playlistId = useLibraryStore((s) => s.playlistId);

  return (
    <LibraryNav
      // Nothing in the library section is current while a playlist is open: the
      // playlist is what the content pane is showing, and two highlighted rows
      // would be two answers to one question.
      active={playlistId === null ? tab : null}
      onSelect={(view) => void showTab(view)}
    />
  );
}
