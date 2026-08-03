/**
 * Webview zoom, not CSS scaling.
 *
 * `setZoom` scales the whole rendering while leaving CSS pixel coordinates
 * untouched: `ROW_HEIGHT` stays 26 at any zoom, `getBoundingClientRect` keeps
 * returning CSS pixels, and the virtualizer needs no knowledge of the setting.
 * Under a CSS `transform` or `zoom` the rendered row and the estimate drift
 * apart, which shows up as overlapping rows and a scrollbar that lies. Text is
 * also laid out at the target size rather than rasterized and stretched.
 *
 * The default is 1.0 because phase 21a rebased the density: an app whose
 * slider has to be moved on every install is admitting its own sizing is
 * wrong.
 */
export const MIN_ZOOM = 0.8;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 0.1;
export const DEFAULT_ZOOM = 1;

/**
 * Rounds to one decimal and clamps to the supported range.
 *
 * Rounding matters more than it looks: 0.1 is not representable in binary, so
 * repeated `+= 0.1` reaches 0.9999999999999999 and the label reads "1.0" while
 * the stored value is not 1. Every path that changes zoom goes through this.
 */
export function clampZoom(factor: number): number {
  if (!Number.isFinite(factor)) {
    return DEFAULT_ZOOM;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(factor * 10) / 10));
}

/** One step out from `factor`, clamped. `direction` is +1 or -1. */
export function steppedZoom(factor: number, direction: number): number {
  return clampZoom(factor + ZOOM_STEP * Math.sign(direction));
}

/** Reads a stored value, falling back to the default for anything unusable. */
export function parseZoom(stored: string | null): number {
  if (stored === null) {
    return DEFAULT_ZOOM;
  }
  const parsed = Number.parseFloat(stored);
  return Number.isNaN(parsed) ? DEFAULT_ZOOM : clampZoom(parsed);
}

/** How the current zoom is shown beside the slider. */
export function formatZoom(factor: number): string {
  return `${Math.round(factor * 100)}%`;
}

/**
 * Which zoom change, if any, a keydown asks for.
 *
 * Ctrl+plus / Ctrl+minus / Ctrl+0 are what users try. Handling them here keeps
 * the slider honest: left alone, the webview may act on them itself and the
 * slider would then be reporting a value that is no longer true.
 *
 * `=` and `-` are matched as well as `+` and `_`, because Ctrl+plus on most
 * layouts arrives as the unshifted key.
 */
export function zoomKey(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): "in" | "out" | "reset" | null {
  if (!event.ctrlKey && !event.metaKey) {
    return null;
  }
  switch (event.key) {
    case "+":
    case "=":
      return "in";
    case "-":
    case "_":
      return "out";
    case "0":
      return "reset";
    default:
      return null;
  }
}
