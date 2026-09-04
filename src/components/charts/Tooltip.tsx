import type { ReactNode } from "react";

/**
 * How wide a tooltip is allowed to get, in pixels.
 *
 * A constant rather than a measurement: the box is positioned in the same
 * frame the pointer moved in, and measuring it first would mean drawing it
 * somewhere wrong to find out where it goes. `.chart-tooltip` caps its width
 * to the same number - change one, change both.
 */
export const TOOLTIP_WIDTH = 160;

export interface TooltipProps {
  /** Where the tooltip points, in the plot's coordinates. */
  readonly x: number;
  readonly y: number;
  /** How wide the plot is, so the box can be kept inside it. */
  readonly within: number;
  readonly children: ReactNode;
}

/**
 * The hover readout for a mark.
 *
 * The app's native-feel rule is that nothing has a hover state; a chart is the
 * deliberate exception, because a bar whose value you cannot read is a picture
 * rather than a figure. Rendered by the panel only while something is hovered,
 * so there is no `visible` prop and no empty box in the DOM between hovers.
 */
export function Tooltip({ x, y, within, children }: TooltipProps) {
  // The box is centred on the point by CSS, so half of it hangs either side
  // and the clamp is against that half rather than against the whole width.
  const half = TOOLTIP_WIDTH / 2;
  const left = Math.min(Math.max(x, half), Math.max(half, within - half));

  return (
    <div className="chart-tooltip" role="tooltip" style={{ left: `${left}px`, top: `${y}px` }}>
      {children}
    </div>
  );
}
