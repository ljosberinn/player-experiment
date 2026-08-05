// biome-ignore-all lint/a11y/noStaticElementInteractions: the title bar is a
// drag and double-click surface rather than a control. Both gestures are
// window management, and the Minimize/Maximize/Close buttons sitting on the
// bar are the keyboard route to the same things.
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReactNode } from "react";

/**
 * The window's own title bar.
 *
 * `decorations: false` in tauri.conf.json removes the OS frame so the
 * transport controls, status display and search box can share one bar, as in
 * iTunes. That means dragging and the window buttons are ours to provide.
 */
export function TitleBar({
  children,
  // Absent until `get_app_info` answers, which is a real state on every launch
  // and lasts a frame or two. Optional rather than required so that is spelled
  // as one thing rather than as `version={null}` at every call site.
  version = null,
}: {
  children: ReactNode;
  version?: string | null;
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
    <header className="titlebar" onMouseDown={onMouseDown} data-testid="titlebar">
      {/* The mark and the wordmark, as the design draws them: a rounded accent
          square holding a play triangle, then APEX. Drawn in CSS rather than
          shipped as an image - it is two rectangles and a triangle, and an
          image would be one more asset to keep in step with the palette. */}
      <span className="titlebar-brand">
        <span className="titlebar-mark" aria-hidden="true" />
        <span className="titlebar-wordmark">APEX</span>
      </span>

      {children}

      {/* The far end of the bar, wrapped rather than pushed there one at a
          time: the version is absent for the first frame of every launch, and
          two `margin-left: auto` items would share the free space between
          them rather than one taking it all. */}
      <div className="titlebar-right">
        {/* Read from the Rust crate rather than baked in at build time: that
            version is the one the installer and every export report. It moved
            here from the status bar in phase 34, where the design puts it and
            where the rest of the app's identity now lives. */}
        {version === null ? null : <span className="titlebar-version">v{version}</span>}
        <WindowButtons />
      </div>
    </header>
  );
}

function WindowButtons() {
  const appWindow = () => getCurrentWindow();

  return (
    <div className="window-buttons">
      <button type="button" aria-label="Minimize" onClick={() => void appWindow().minimize()}>
        &#xE921;
      </button>
      <button type="button" aria-label="Maximize" onClick={() => void appWindow().toggleMaximize()}>
        &#xE922;
      </button>
      <button
        type="button"
        aria-label="Close"
        className="close"
        onClick={() => void appWindow().close()}
      >
        &#xE8BB;
      </button>
    </div>
  );
}
