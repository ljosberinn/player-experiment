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
export function TitleBar({ children }: { children: ReactNode }) {
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
      {children}
      <WindowButtons />
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
