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
 * there is anything to undo. Asserting that with a rendered menu means opening
 * five popups per case; asserting it here is a function call.
 *
 * `MenuBar` renders the result, and `rowMenuItems` supplies the Edit menu's
 * middle so that the right-click menu and the Edit menu cannot drift apart -
 * they are the same actions on the same selection, and phase 34's whole reason
 * for Edit existing is that a menu bar should be able to do what a right-click
 * can.
 */
export function menus({
  missingCount,
  canUndoTags,
  hasExportTarget,
  exportSelectionLabel,
  rowItems,
  onAddFolder,
  onRescan,
  onRemoveMissing,
  onUndoTags,
  onSettings,
  onExportAll,
  onExportSelection,
  onOpenRepository,
}: {
  missingCount: number;
  canUndoTags: boolean;
  /** Whether Export Selection has anything to write. */
  hasExportTarget: boolean;
  /** What Export Selection is about to export - a count, or a playlist. */
  exportSelectionLabel: string;
  /** The song actions, from `rowMenuItems`. Empty with nothing selected. */
  rowItems: MenuItem[];
  onAddFolder: () => void;
  onRescan: () => void;
  onRemoveMissing: () => void;
  onUndoTags: () => void;
  onSettings: () => void;
  onExportAll: () => void;
  onExportSelection: () => void;
  onOpenRepository: () => void;
}): Menu[] {
  const file: MenuItem[] = [
    { label: "Add Folder…", onSelect: onAddFolder },
    { label: "Rescan", onSelect: onRescan },
  ];

  // Only when there is something to clear, which in a library whose drives are
  // all plugged in is never. This is the entry the design had nowhere for - a
  // mockup has no missing files - and the File menu is where it belongs, beside
  // the scan that discovers them.
  if (missingCount > 0) {
    file.push(
      { kind: "separator" },
      {
        label: `Remove ${missingCount} Missing Song${missingCount === 1 ? "" : "s"}…`,
        onSelect: onRemoveMissing,
      },
    );
  }

  return [
    { label: "File", items: file },
    {
      label: "Edit",
      items: [
        // The song actions first, acting on the selection. With nothing
        // selected there are none, and what is left is Undo and Settings -
        // both of which act on the app rather than on songs.
        ...rowItems,
        ...(rowItems.length > 0 ? [{ kind: "separator" as const }] : []),
        { label: "Undo Tag Edit", disabled: !canUndoTags, onSelect: onUndoTags },
        { kind: "separator" },
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
    // Present, empty and unopenable. This is where last.fm lands
    // (docs/plans/lastfm.md); shipping the empty menu now means the bar does not
    // change shape when it arrives.
    { label: "Account", items: [], disabled: true },
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
