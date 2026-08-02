/**
 * Remembering where the window was.
 *
 * The parsing and clamping live here, apart from the Tauri calls, because
 * "restore the window" is the part that can silently strand a window on a
 * monitor that no longer exists.
 */

export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** Below this the chrome does not fit, whatever was stored. */
export const MIN_WIDTH = 640;
export const MIN_HEIGHT = 400;

export function serialize(geometry: Geometry): string {
  return JSON.stringify(geometry);
}

/**
 * Reads stored geometry back, or null for anything unusable.
 *
 * Null rather than a default: the caller should leave the window wherever the
 * OS put it rather than move it somewhere arbitrary on the strength of a
 * corrupt setting.
 */
export function parse(stored: string | null): Geometry | null {
  if (stored === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const value = parsed as Record<string, unknown>;
    const geometry = {
      x: numberOr(value.x, null),
      y: numberOr(value.y, null),
      width: numberOr(value.width, null),
      height: numberOr(value.height, null),
      maximized: value.maximized === true,
    };
    if (geometry.x === null || geometry.y === null) {
      return null;
    }
    if (geometry.width === null || geometry.height === null) {
      return null;
    }
    return {
      x: geometry.x,
      y: geometry.y,
      // A window smaller than its own chrome is unusable, and a stored size
      // from a since-changed layout is exactly how that happens.
      width: Math.max(geometry.width, MIN_WIDTH),
      height: Math.max(geometry.height, MIN_HEIGHT),
      maximized: geometry.maximized,
    };
  } catch {
    return null;
  }
}

function numberOr(value: unknown, fallback: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Whether a stored position still lands on a screen.
 *
 * Unplugging the second monitor is the ordinary way a remembered position
 * becomes a window you cannot see or reach. Any overlap counts - a window
 * mostly off-screen is still draggable back.
 */
export function isOnScreen(
  geometry: Geometry,
  screens: readonly { x: number; y: number; width: number; height: number }[],
): boolean {
  // A visible sliver is enough to grab; demanding more would move windows the
  // user deliberately parked at an edge.
  const margin = 80;
  return screens.some(
    (screen) =>
      geometry.x + geometry.width > screen.x + margin &&
      geometry.x < screen.x + screen.width - margin &&
      geometry.y + geometry.height > screen.y &&
      // The title bar has to be reachable, so the top edge must be on-screen.
      geometry.y < screen.y + screen.height - margin,
  );
}
