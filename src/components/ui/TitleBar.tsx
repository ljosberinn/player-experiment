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
  const startDragging = (event: React.PointerEvent) => {
    // Only a primary-button press on the bar itself should drag; clicks that
    // land on a control inside it must reach that control.
    if (event.button !== 0 || event.target !== event.currentTarget) {
      return;
    }
    void getCurrentWindow().startDragging();
  };

  return (
    <header className="titlebar" onPointerDown={startDragging} data-testid="titlebar">
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
