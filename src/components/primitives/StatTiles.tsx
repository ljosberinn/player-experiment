import { StatFigure } from "./figure";

/** One cell of the grid: an eyebrow, a figure, and a line of prose under it. */
export interface StatTileProps {
  readonly label: string;
  /** Formatted by the caller: only the panel knows whether this is a count,
   * a duration or a byte size. */
  readonly value: string;
  /** Drawn smaller, riding on the figure rather than under it. */
  readonly unit?: string;
  /** A third line - a share, a comparison, a caveat. */
  readonly caption?: string;
  /** Takes the caption to the accent: a movement rather than a fact. */
  readonly delta?: boolean;
}

/**
 * Bordered cells, for the figures that need a line of prose under them.
 *
 * Section 4a's lower drawing. The gap between the cells is a colour behind
 * them rather than a border on each, so an interior edge is one line wide
 * instead of two - `library.css` does that and there is nothing to pass.
 *
 * One `<dl>` around the set rather than one per cell, so six tiles are one
 * group of six pairs rather than twelve unrelated announcements.
 */
export function StatTiles({ tiles }: { tiles: readonly StatTileProps[] }) {
  return (
    <dl className="stat-tiles">
      {tiles.map((tile) => (
        <div className="stat-tile" key={tile.label}>
          <dt>{tile.label}</dt>
          <dd className="stat-tile-value">
            <StatFigure value={tile.value} unit={tile.unit} />
          </dd>
          {/* Left out rather than emptied: an empty element still takes the
              line's height, so a row of cells would be ragged. */}
          {tile.caption !== undefined && (
            <dd className={tile.delta === true ? "stat-tile-caption delta" : "stat-tile-caption"}>
              {tile.caption}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
