import type { ReactNode } from "react";

/**
 * The app's own bar, under the OS frame.
 *
 * It was the window's title bar until phase 119, when `decorations: false`
 * went and the OS took the frame back. What it carries did not change - the
 * mark, the menus and the version - so the bar stayed and the window
 * management left: the drag region, the double-click-to-maximize and the
 * minimise/maximise/close glyphs are all the frame's again.
 */
export function AppBar({
  children,
  // Absent until `get_app_info` answers, which is a real state on every launch
  // and lasts a frame or two. Optional rather than required so that is spelled
  // as one thing rather than as `version={null}` at every call site.
  version = null,
}: {
  children: ReactNode;
  version?: string | null;
}) {
  return (
    <header className="appbar">
      {/* The mark and the wordmark, as the design draws them: a rounded accent
          square holding a play triangle, then APEX. Drawn in CSS rather than
          shipped as an image - it is two rectangles and a triangle, and an
          image would be one more asset to keep in step with the palette. */}
      <span className="appbar-brand">
        <span className="appbar-mark" aria-hidden="true" />
        <span className="appbar-wordmark">APEX</span>
      </span>

      {children}

      {/* Read from the Rust crate rather than baked in at build time: that
          version is the one the installer and every export report. */}
      {version === null ? null : <span className="appbar-version">v{version}</span>}
    </header>
  );
}
