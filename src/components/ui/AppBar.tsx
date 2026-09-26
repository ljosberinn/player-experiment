// biome-ignore-all lint/a11y/noStaticElementInteractions: the bar is a drag and
// double-click surface rather than a control. Both gestures are window
// management, and the Minimize/Maximize/Close buttons sitting on the bar are
// the keyboard route to the same things.
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReactNode } from "react";

/**
 * The app's bar, and the window's title bar.
 *
 * `decorations: false` in tauri.conf.json removes the OS frame, so dragging,
 * double-click-to-maximize and the window buttons are ours to provide. Phase
 * 119 gave the frame to the OS for a while; 158 took it back.
 */
export function AppBar({
  children,
  // A slot rather than more children because the version sits between the two:
  // it follows the menus, and the search field takes the free space after it.
  search,
  // Absent until `get_app_info` answers, which is a real state on every launch
  // and lasts a frame or two. Optional rather than required so that is spelled
  // as one thing rather than as `version={null}` at every call site.
  version = null,
  // After the version, which it offers to replace. A slot so the bar stays
  // presentational; what decides whether there is an update is the updater's.
  update,
}: {
  children?: ReactNode;
  search?: ReactNode;
  version?: string | null;
  update?: ReactNode;
}) {
  /**
   * Drag the window, or maximize it on a double press.
   *
   * Both live in one `mousedown` handler because they cannot be separated:
   * `startDragging` hands the drag loop to the OS, which then swallows the
   * mouseup and the second click, so an `onDoubleClick` on a bar that also
   * drags never fires. The second press of a double click is `detail === 2`,
   * and that is the only signal available before the drag begins.
   *
   * `mousedown` rather than `pointerdown` for the same reason: `detail` is a
   * mouse-event property, and the pointer event arrives first.
   */
  const onMouseDown = (event: React.MouseEvent) => {
    // Only a primary press on the bar itself; presses that land on a control
    // inside it must reach that control, and double-clicking the search box
    // should select a word rather than resize the window.
    if (event.button !== 0 || event.target !== event.currentTarget) {
      return;
    }
    if (event.detail === 2) {
      void getCurrentWindow().toggleMaximize();
      return;
    }
    void getCurrentWindow().startDragging();
  };

  return (
    <header className="appbar" onMouseDown={onMouseDown}>
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

      {update}

      {search}

      <WindowButtons />
    </header>
  );
}

function WindowButtons() {
  return (
    <div className="window-buttons">
      <button
        type="button"
        aria-label="Minimize"
        onClick={() => void getCurrentWindow().minimize()}
      >
        &#xE921;
      </button>
      <button
        type="button"
        aria-label="Maximize"
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        &#xE922;
      </button>
      <button
        type="button"
        aria-label="Close"
        className="close"
        onClick={() => void getCurrentWindow().close()}
      >
        &#xE8BB;
      </button>
    </div>
  );
}
