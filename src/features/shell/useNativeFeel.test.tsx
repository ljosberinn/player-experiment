import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useNativeFeel } from "./useNativeFeel";

function Harness() {
  useNativeFeel();
  return (
    <div>
      <div data-testid="row">A song row</div>
      <input aria-label="Search" type="search" />
      <input aria-label="Volume" type="range" />
      <textarea aria-label="Comment" />
    </div>
  );
}

/** Right-clicks `target` and reports whether the OS menu would still open. */
function nativeMenuOpens(target: Element): boolean {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return !event.defaultPrevented;
}

describe("useNativeFeel", () => {
  it("suppresses the webview menu on the app's own surfaces", () => {
    render(<Harness />);

    // A desktop application does not offer "Reload" and "View Page Source"
    // on a song.
    expect(nativeMenuOpens(screen.getByTestId("row"))).toBe(false);
  });

  it("leaves text fields their own menu", () => {
    render(<Harness />);

    // Cut/Copy/Paste, and on Windows the IME entries, are real functionality
    // the app does not reimplement.
    expect(nativeMenuOpens(screen.getByRole("searchbox", { name: "Search" }))).toBe(true);
    expect(nativeMenuOpens(screen.getByRole("textbox", { name: "Comment" }))).toBe(true);
  });

  it("suppresses it on inputs with nothing to paste into", () => {
    render(<Harness />);

    // A range is an input, but a paste menu over the volume slider is noise.
    expect(nativeMenuOpens(screen.getByRole("slider", { name: "Volume" }))).toBe(false);
  });

  it("still lets the app open its own menu", () => {
    render(<Harness />);
    const row = screen.getByTestId("row");
    let sawEvent = false;
    row.addEventListener("contextmenu", () => {
      sawEvent = true;
    });

    fireEvent.contextMenu(row);

    // The suppression is on the document, so per-element handlers have already
    // run by the time it fires - otherwise it would kill the row menus too.
    expect(sawEvent).toBe(true);
  });

  it("stops a file dropped on nothing from navigating the window away", () => {
    render(<Harness />);
    const transfer = { dropEffect: "copy", types: ["Files"] };

    const dropped = fireEvent.drop(screen.getByTestId("row"), { dataTransfer: transfer });
    fireEvent.dragOver(screen.getByTestId("row"), { dataTransfer: transfer });

    // Unhandled, the webview opens the file and the app is gone until it is
    // relaunched. Not hypothetical now that the tag editor asks for images.
    expect(dropped).toBe(false);
    // And the pointer says so on the way in, rather than the window claiming
    // to accept everything.
    expect(transfer.dropEffect).toBe("none");
  });

  it("leaves a real drop target alone", () => {
    render(<Harness />);
    const target = screen.getByTestId("row");
    target.addEventListener("dragover", (event) => event.preventDefault());
    const transfer = { dropEffect: "copy", types: ["Files"] };

    fireEvent.dragOver(target, { dataTransfer: transfer });

    // The guard runs at the window, after the target has had its say, and only
    // claims drags nothing else accepted - otherwise it would swallow the
    // artwork square's own.
    expect(transfer.dropEffect).toBe("copy");
  });

  it("stops suppressing once unmounted", () => {
    const { unmount } = render(<Harness />);
    const loose = document.createElement("div");
    document.body.appendChild(loose);

    unmount();

    expect(nativeMenuOpens(loose)).toBe(true);
    loose.remove();
  });
});
