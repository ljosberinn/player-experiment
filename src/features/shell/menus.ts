import type { MenuItem } from "../../components/ui/ContextMenu";

/** One top-level menu on the bar. */
export interface Menu {
  label: string;
  items: MenuItem[];
  /** Shown, and unopenable. Account is this until last.fm arrives. */
  disabled?: boolean;
}

/**
 * Where Help points. One of the three hosts the opener capability allows, the
 * other two being the sites a row can be looked up on (`externalLinks.ts`).
 */
export const REPOSITORY = "https://github.com/ljosberinn/player-experiment";

/**
 * What the menu bar offers, given the state of the app.
 *
 * Pure, and the reason it is: which entries appear, which are disabled and what
 * they say are the whole of this feature, and every one of them depends on
 * something - whether a row is selected, whether a playlist is open, whether
 * any file is missing. Asserting that with a rendered menu means opening five
 * popups per case; asserting it here is a function call.
 *
 * `MenuBar` renders the result, and `rowMenuItems` supplies the Edit menu's
 * middle so that the right-click menu and the Edit menu cannot drift apart -
 * they are the same actions on the same selection, and phase 34's whole reason
 * for Edit existing is that a menu bar should be able to do what a right-click
 * can.
 */
export function menus({
  selectionCount,
  missingCount,
  removedCount,
  hasExportTarget,
  exportSelectionLabel,
  lastfmConfigured,
  lastfmUsername,
  rowItems,
  onAddFolder,
  onRescan,
  onRemoveFromLibrary,
  onRemoveMissing,
  onForgetRemoved,
  onSettings,
  onExportAll,
  onExportSelection,
  onLastfmDisconnect,
  onOpenRepository,
}: {
  /** How many songs are selected; what File's removal entry acts on. */
  selectionCount: number;
  missingCount: number;
  /** How many paths a removal has tombstoned. See migration 7. */
  removedCount: number;
  /** Whether Export Selection has anything to write. */
  hasExportTarget: boolean;
  /** What Export Selection is about to export - a count, or a playlist. */
  exportSelectionLabel: string;
  /** Whether this build carries a last.fm API key at all. */
  lastfmConfigured: boolean;
  /** The connected last.fm account, or null. */
  lastfmUsername: string | null;
  /** The song actions, from `rowMenuItems`. Empty with nothing selected. */
  rowItems: MenuItem[];
  onAddFolder: () => void;
  onRescan: () => void;
  /** Asks to remove the selection from the library. */
  onRemoveFromLibrary: () => void;
  onRemoveMissing: () => void;
  onForgetRemoved: () => void;
  onSettings: () => void;
  onExportAll: () => void;
  onExportSelection: () => void;
  onLastfmDisconnect: () => void;
  onOpenRepository: () => void;
}): Menu[] {
  const file: MenuItem[] = [
    { label: "Add Folders…", onSelect: onAddFolder },
    { label: "Rescan", onSelect: onRescan },
  ];

  // The three row-destroying entries, each absent when it has nothing to act
  // on - which for the last two, in a library whose drives are all plugged in
  // and whose songs the user has all kept, is always. They were the entries
  // the design had nowhere for - a mockup has no missing files - and the File
  // menu is where they belong, beside the scan that discovers them.
  //
  // Removing the selection is here rather than in Edit alongside the other
  // song actions because the user asked for it beside the other two: the three
  // are one group, and splitting them across two menus would be one group in
  // two places.
  const destructive: MenuItem[] = [];
  if (selectionCount > 0) {
    destructive.push({
      label: `Remove ${selectionCount} Song${selectionCount === 1 ? "" : "s"} from Library…`,
      onSelect: onRemoveFromLibrary,
    });
  }
  if (missingCount > 0) {
    destructive.push({
      label: `Remove ${missingCount} Missing Song${missingCount === 1 ? "" : "s"}…`,
      onSelect: onRemoveMissing,
    });
  }
  if (removedCount > 0) {
    destructive.push({
      label: `Forget ${removedCount} Removed Song${removedCount === 1 ? "" : "s"}…`,
      onSelect: onForgetRemoved,
    });
  }
  if (destructive.length > 0) {
    file.push({ kind: "separator" }, ...destructive);
  }

  return [
    { label: "File", items: file },
    {
      label: "Edit",
      items: [
        // The song actions first, acting on the selection. With nothing
        // selected there are none, and Settings is all that is left - it acts
        // on the app rather than on songs, so it needs no separator of its own
        // to sit under.
        ...rowItems,
        ...(rowItems.length > 0 ? [{ kind: "separator" as const }] : []),
        { label: "Settings…", onSelect: onSettings },
      ],
    },
    {
      label: "Export",
      items: [
        { label: "Export All…", onSelect: onExportAll },
        {
          label: exportSelectionLabel,
          // Nothing selected and no playlist open means nothing to write. The
          // entry stays, greyed: it is the same action, waiting for a subject.
          disabled: !hasExportTarget,
          onSelect: onExportSelection,
        },
      ],
    },
    // Shipped empty and disabled since phase 34 so the bar would not change
    // shape when last.fm arrived. It has.
    //
    // Connecting is not here: it is a browser trip that needs somewhere to say
    // what leaves the machine, and a menu item has no room for that. So the
    // menu offers the two things a menu is good for - saying who is connected,
    // and the one-click way out - and sends the rest to Settings.
    {
      label: "Account",
      items: lastfmConfigured
        ? lastfmUsername === null
          ? [{ label: "Connect to last.fm…", onSelect: onSettings }]
          : [
              // Informational, so disabled rather than actionable: there is
              // nothing to do to the name itself.
              { label: `last.fm: ${lastfmUsername}`, disabled: true },
              { kind: "separator" },
              { label: "Disconnect from last.fm", onSelect: onLastfmDisconnect },
            ]
        : [],
      // A build with no last.fm key has nothing to put here, which is every
      // local build and every CI run.
      disabled: !lastfmConfigured,
    },
    {
      label: "Help",
      items: [{ label: "Source Code on GitHub", onSelect: onOpenRepository }],
    },
  ];
}

/**
 * What Export Selection says it will do.
 *
 * Three cases, and the middle one is the reason this is not just a count: with
 * a playlist open and no song picked out of it, the thing the user means by
 * "the selection" is the playlist.
 */
export function exportSelectionLabel(selectionCount: number, playlistName: string | null): string {
  if (selectionCount > 0) {
    return `Export ${selectionCount} Song${selectionCount === 1 ? "" : "s"}…`;
  }
  if (playlistName !== null) {
    return `Export “${playlistName}”…`;
  }
  return "Export Selection…";
}
