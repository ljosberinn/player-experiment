import { useLibraryStore } from "../library/store";
import { viewSummary } from "./viewSummary";

/**
 * The count of what the content pane is showing, wherever the pane places it.
 *
 * Its own component so the counts it reads re-render this line and not the
 * app around it. Draws nothing when there is nothing to say, so a wrapper
 * class that pads it costs no space on an empty view.
 */
export function ViewSummaryText({ className }: { className?: string }) {
  const tab = useLibraryStore((s) => s.tab);
  const drilledIn = useLibraryStore((s) => s.browse !== null);
  const groupCount = useLibraryStore((s) => s.groups.length);
  const stats = useLibraryStore((s) => s.stats);

  const text = viewSummary({
    tab,
    drilledIn,
    groupCount,
    trackCount: stats.tracks,
    durationMs: stats.durationMs,
    bytes: stats.bytes,
  });
  if (text === "") {
    return null;
  }
  return <span className={className ? `view-summary ${className}` : "view-summary"}>{text}</span>;
}
