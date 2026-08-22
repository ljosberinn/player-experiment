import type { Colour } from "../../ipc";
import { usePlayerStore } from "../player/store";
import { useDynamicBackgroundStore } from "./dynamicBackgroundStore";

/**
 * Three blurred blobs of the playing cover's colours, behind everything.
 *
 * Sits under the whole window rather than inside any panel: every sheet of
 * chrome in the app is a veil over a `backdrop-filter: blur(18px)` (phase 35),
 * so each one lets a different amount of this through and the window reads as
 * one piece of glass over the record rather than as a tinted panel.
 *
 * Renders nothing at all when there is no palette or the preference is off -
 * not a transparent layer, nothing. A fixed, blurred, animated element is not
 * free even at zero opacity, and the overwhelmingly common state at startup is
 * silence.
 *
 * The colours arrive as CSS custom properties rather than as gradients built
 * here: `App.css` registers them with `@property` so a change between albums
 * can be transitioned, which a `background` string swapped wholesale cannot.
 */
export function DynamicBackground() {
  const palette = usePlayerStore((s) => s.palette);
  const enabled = useDynamicBackgroundStore((s) => s.enabled);

  // Truthiness rather than `=== null`, and deliberately: the type says the
  // only absent value is null, but this is the one component in the app that
  // renders unconditionally on every mount. A store written short of a field
  // should cost the window its wallpaper, not its first paint.
  if (!enabled || !palette || palette.length === 0) {
    return null;
  }

  return (
    // Decoration with nothing to say. `aria-hidden` rather than a `role`,
    // and no keyboard or pointer surface of its own.
    <div
      className="dynamic-bg"
      aria-hidden="true"
      data-testid="dynamic-background"
      style={cssColours(palette)}
    />
  );
}

/**
 * The palette as three custom properties.
 *
 * A palette short of three - which the backend does not produce, but a stored
 * value from an older build could be - repeats its last colour rather than
 * leaving a blob at its initial `transparent`. Two blobs and a hole is worse
 * than two blobs and a third that agrees with one of them.
 */
function cssColours(palette: Colour[]): React.CSSProperties {
  const at = (index: number) => palette[Math.min(index, palette.length - 1)] as Colour;

  return {
    "--blob-1": rgb(at(0)),
    "--blob-2": rgb(at(1)),
    "--blob-3": rgb(at(2)),
  } as React.CSSProperties;
}

function rgb({ r, g, b }: Colour): string {
  return `rgb(${r} ${g} ${b})`;
}
