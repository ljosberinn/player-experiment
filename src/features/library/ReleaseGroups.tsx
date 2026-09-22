import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { coverUrl } from "../../ipc";
import { formatDuration } from "../../lib/format";
import { releaseFormatLine } from "./browse";
import { ColumnHeader } from "./ColumnHeader";
import {
  GROUP_ROW_HEIGHT,
  groupHeight,
  groupOffsets,
  groupOfRow,
  groupRowRange,
} from "./releaseLayout";
import { SongRow } from "./SongRow";
import { isSelected } from "./selection";
import { useLibraryStore } from "./store";
import { type SongTableHandlers, useSongTableWiring } from "./useSongTableWiring";

/** Groups rendered beyond the viewport, so a flick shows content not gaps. */
const OVERSCAN = 2;

/**
 * A drill-in drawn as its releases: a gutter naming each one, and its rows
 * beside it.
 *
 * The sibling of `SongTable` rather than a mode of it - the two place rows
 * differently and share everything else, which `useSongTableWiring` holds.
 * What is different here is that the virtualizer runs over groups rather than
 * rows: a group's height is closed-form (see `releaseLayout`), so every group
 * is placed before any row of it has been fetched, and the rows a group owns
 * are a prefix sum over the release list rather than something read off the
 * rows themselves.
 *
 * That is only correct because the query orders rows by release first - see
 * `query::drill_in_order`, which is written against the same ordering
 * `release_groups` returns.
 */
export function ReleaseGroups({
  onActivate,
  onRemove,
  onRemoveFromLibrary,
  onExport,
  nowPlayingId = null,
}: Omit<SongTableHandlers, "onReorder"> & {
  nowPlayingId?: number | null;
}) {
  // For `SongTable`'s reason: a component holding a virtualizer is not
  // compiled, because TanStack Virtual returns functions whose identity
  // changes without the instance's doing so.
  "use no memo";

  const scrollRef = useRef<HTMLDivElement>(null);
  const releases = useLibraryStore((s) => s.releases);

  const offsets = useMemo(() => groupOffsets(releases), [releases]);

  const virtualizer = useVirtualizer({
    count: releases.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => groupHeight(releases[index]?.trackCount ?? 0),
    overscan: OVERSCAN,
  });

  // Reaching a row means reaching the group that holds it: rows are not what
  // this view scrolls by.
  const scrollToRow = useCallback(
    (rowIndex: number) => virtualizer.scrollToIndex(groupOfRow(releases, rowIndex)),
    [virtualizer, releases],
  );

  const {
    total,
    columns,
    sortBy,
    direction,
    selection,
    rowAt,
    queryToken,
    ensureRange,
    toggleSort,
    actions,
    setMenu,
    menuItems,
  } = useSongTableWiring({
    scrollRef,
    scrollToRow,
    // No `onReorder`: a drill-in is ordered by release, which is not an order
    // there is anything to rearrange.
    handlers: { onActivate, onRemove, onRemoveFromLibrary, onExport },
  });

  const items = virtualizer.getVirtualItems();
  const firstGroup = items[0]?.index ?? 0;
  const lastGroup = items[items.length - 1]?.index ?? 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: queryToken is a cache key, not a value this effect reads - it changes exactly when the cached pages are dropped, which is when the visible range must be fetched again even though the range itself has not moved.
  useEffect(() => {
    const range = groupRowRange(releases, firstGroup, lastGroup);
    if (range !== null) {
      void ensureRange(range.start, range.end);
    }
  }, [ensureRange, releases, firstGroup, lastGroup, queryToken]);

  return (
    <div className="song-body release-body" ref={scrollRef} data-testid="song-scroll">
      {/* One header for every group: the gutter is a fixed width, so each
          group's table starts at the same x and this is that inset. Not
          `aria-hidden`, however decorative it looks beside the groups - it
          carries the column names and the sort state, and hiding it would
          leave a screen reader with unlabelled cells. */}
      <table className="song-table release-header-table">
        <thead>
          <ColumnHeader
            columns={columns}
            sortBy={sortBy}
            direction={direction}
            onSort={(id) => void toggleSort(id)}
          />
        </thead>
      </table>

      {/* The whole group area is the trigger, so the menu opens where the
          pointer is without anybody carrying coordinates around. */}
      <ContextMenu
        label="Song actions"
        render={<div className="release-groups" style={{ height: virtualizer.getTotalSize() }} />}
        onOpenChange={(open) => {
          if (!open) {
            setMenu(null);
          }
        }}
        items={menuItems}
      >
        {items.map((item) => {
          const group = releases[item.index];
          if (group === undefined) {
            return null;
          }
          const offset = offsets[item.index] as number;
          const formatLine = releaseFormatLine(group);

          return (
            <section
              key={group.id}
              className="release-group"
              style={{ height: item.size, transform: `translateY(${item.start}px)` }}
            >
              <div className="release-gutter">
                {group.coverHash === null ? (
                  // Not an <img> with a placeholder src, for `BrowseView`'s
                  // reason: a broken image is a failed request and an icon the
                  // browser picks.
                  <span className="release-cover-empty" aria-hidden="true" />
                ) : (
                  <img
                    className="release-cover"
                    src={coverUrl(group.coverHash)}
                    alt=""
                    loading="lazy"
                  />
                )}
                <div className="release-labels">
                  <span className="release-title">{group.title ?? "Unknown Album"}</span>
                  {group.year === null || group.year === 0 ? null : (
                    <span className="release-year">{group.year}</span>
                  )}
                  {formatLine === null ? null : (
                    <span className="release-format">{formatLine}</span>
                  )}
                </div>
              </div>

              <table className="song-table" aria-rowcount={total}>
                {/* Its rows are absolutely positioned, so the height has to be
                    stated or the body collapses to nothing. */}
                <tbody style={{ height: group.trackCount * GROUP_ROW_HEIGHT }}>
                  {Array.from({ length: group.trackCount }, (_, within) => {
                    const rowIndex = offset + within;
                    const track = rowAt(rowIndex);
                    return (
                      <SongRow
                        key={rowIndex}
                        track={track}
                        rowIndex={rowIndex}
                        top={within * GROUP_ROW_HEIGHT}
                        height={GROUP_ROW_HEIGHT}
                        selected={track !== null && isSelected(selection, track.id)}
                        playing={track !== null && track.id === nowPlayingId}
                        // Nothing to drop here: this view has no order of its
                        // own to rearrange.
                        drop={null}
                        columns={columns}
                        actions={actions}
                      />
                    );
                  })}
                </tbody>
                <tfoot>
                  {/* Per group, which is what keeps it from restating the
                      status bar: at one group the two coincide by arithmetic
                      rather than by saying the same thing. */}
                  <tr className="release-total">
                    <td>
                      {group.trackCount} {group.trackCount === 1 ? "song" : "songs"}
                    </td>
                    <td>{formatDuration(group.durationMs)}</td>
                  </tr>
                </tfoot>
              </table>
            </section>
          );
        })}
      </ContextMenu>
    </div>
  );
}
