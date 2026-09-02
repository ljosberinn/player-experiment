import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeTrackDragClick,
  dropIndexAt,
  dropIndexFor,
  edgeScrollSpeed,
  isTrackDragging,
  onTrackDragEnd,
  pressTrackRow,
  trackDragIds,
} from "./trackDrag";

function pointer(type: string, x = 0, y = 0) {
  window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true }));
}

/** Presses a row and drags it far enough to be recognised. */
function drag(ids: number[], to: { x: number; y: number } = { x: 0, y: 40 }) {
  pressTrackRow({ clientX: 0, clientY: 0 }, () => ids);
  pointer("pointermove", to.x, to.y);
}

function badge(): HTMLElement | null {
  return document.querySelector(".drag-badge");
}

afterEach(() => {
  // Every test leaves the session in whatever state it was asserting about,
  // and the module is shared; a release ends any of them.
  pointer("pointerup");
  consumeTrackDragClick();
});

describe("recognising a drag", () => {
  it("is still a click until the pointer has travelled far enough", () => {
    pressTrackRow({ clientX: 100, clientY: 100 }, () => [1]);
    pointer("pointermove", 102, 101);

    expect(isTrackDragging()).toBe(false);
    expect(badge()).toBeNull();
  });

  it("measures the distance, not the horizontal part of it", () => {
    // A row drag is vertical for a reorder and horizontal for the sidebar, so
    // the threshold the column headers use - x alone - would miss half of them.
    pressTrackRow({ clientX: 100, clientY: 100 }, () => [1]);
    pointer("pointermove", 100, 104);

    expect(isTrackDragging()).toBe(true);
  });

  it("carries what the source decided at the moment of recognition", () => {
    const begin = vi.fn(() => [4, 5, 6]);
    pressTrackRow({ clientX: 0, clientY: 0 }, begin);

    // Not on the press: until the threshold is crossed this is a click, and a
    // click must not move the selection out from under itself.
    expect(begin).not.toHaveBeenCalled();

    pointer("pointermove", 0, 40);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(trackDragIds()).toEqual([4, 5, 6]);
  });

  it("starts no drag when the source has nothing to carry", () => {
    drag([]);

    expect(isTrackDragging()).toBe(false);
    expect(badge()).toBeNull();
  });
});

describe("the badge", () => {
  it("carries a count rather than a picture of the table", () => {
    drag([1, 2, 3, 4, 5, 6, 7]);

    expect(badge()?.textContent).toBe("7 songs");
  });

  it("says it in the singular for one", () => {
    drag([9]);

    expect(badge()?.textContent).toBe("1 song");
  });

  it("follows the pointer, offset clear of it", () => {
    drag([9]);
    const first = badge()?.style.transform;

    pointer("pointermove", 300, 400);
    const moved = badge()?.style.transform;

    expect(moved).not.toBe(first);
    // Down and to the right, the way Explorer carries one: sitting on the
    // pointer would hide the row being aimed at.
    const [x, y] = /translate\((\d+)px, (\d+)px\)/.exec(moved ?? "")?.slice(1) ?? [];
    expect(Number(x)).toBeGreaterThan(300);
    expect(Number(y)).toBeGreaterThan(400);
  });

  it("is gone once the drag is", () => {
    drag([9]);
    pointer("pointerup");

    expect(badge()).toBeNull();
  });
});

describe("ending a drag", () => {
  it("leaves nothing for a drop target to read", () => {
    drag([9]);
    pointer("pointerup");

    expect(isTrackDragging()).toBe(false);
    expect(trackDragIds()).toEqual([]);
  });

  it("tells the drop targets, whose indicators nothing else would clear", () => {
    const ended = vi.fn();
    const off = onTrackDragEnd(ended);
    drag([9]);
    pointer("pointerup");

    expect(ended).toHaveBeenCalledTimes(1);
    off();
  });

  it("does not announce an end for a press that was only ever a click", () => {
    const ended = vi.fn();
    const off = onTrackDragEnd(ended);
    pressTrackRow({ clientX: 0, clientY: 0 }, () => [1]);
    pointer("pointerup");

    expect(ended).not.toHaveBeenCalled();
    off();
  });

  it("abandons the drag on Escape, without a drop", () => {
    const ended = vi.fn();
    const off = onTrackDragEnd(ended);
    drag([9]);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(isTrackDragging()).toBe(false);
    expect(badge()).toBeNull();
    expect(ended).toHaveBeenCalledTimes(1);
    off();
  });

  it("abandons the drag on pointercancel", () => {
    drag([9]);
    pointer("pointercancel");

    expect(isTrackDragging()).toBe(false);
    expect(badge()).toBeNull();
  });
});

describe("the click that follows", () => {
  it("is swallowed after a drag, or a reorder would also re-select its row", () => {
    drag([9]);
    pointer("pointerup");

    expect(consumeTrackDragClick()).toBe(true);
  });

  it("is swallowed once", () => {
    drag([9]);
    pointer("pointerup");
    consumeTrackDragClick();

    expect(consumeTrackDragClick()).toBe(false);
  });

  it("is left alone after a press that never became a drag", () => {
    pressTrackRow({ clientX: 0, clientY: 0 }, () => [1]);
    pointer("pointerup");

    expect(consumeTrackDragClick()).toBe(false);
  });

  it("is swallowed after a cancelled drag too", () => {
    // The pointer is still down: Escape is followed by a real pointerup and a
    // real click, and that click is no more a selection than the drop was.
    drag([9]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(consumeTrackDragClick()).toBe(true);
  });

  it("is not swallowed by a flag left over from a drag that ended elsewhere", () => {
    // A drag dropped on the sidebar fires its click on nothing that consumes
    // one, so the next press has to clear it.
    drag([9]);
    pointer("pointerup");
    pressTrackRow({ clientX: 0, clientY: 0 }, () => [1]);

    expect(consumeTrackDragClick()).toBe(false);
  });
});

describe("dropIndexFor", () => {
  it("puts a drop on the upper half above the row", () => {
    expect(dropIndexFor(4, 0, 22)).toBe(4);
    expect(dropIndexFor(4, 10, 22)).toBe(4);
  });

  it("puts a drop on the lower half below the row", () => {
    expect(dropIndexFor(4, 11, 22)).toBe(5);
    expect(dropIndexFor(4, 21, 22)).toBe(5);
  });

  it("can express a drop after the last row", () => {
    // Without the lower half resolving to index+1 there would be no way to
    // move something to the very end.
    expect(dropIndexFor(9, 20, 22)).toBe(10);
  });
});

describe("dropIndexAt", () => {
  it("agrees with dropIndexFor about where the halfway line is", () => {
    // Same answer from a position in the whole list as from the row under it,
    // which is what lets the auto-scroll loop update without a row to ask.
    expect(dropIndexAt(4 * 22 + 10, 22, 500)).toBe(dropIndexFor(4, 10, 22));
    expect(dropIndexAt(4 * 22 + 11, 22, 500)).toBe(dropIndexFor(4, 11, 22));
  });

  it("clamps to the ends of the list", () => {
    // The pointer can be above the first row or below the last while the list
    // scrolls under it.
    expect(dropIndexAt(-200, 22, 10)).toBe(0);
    expect(dropIndexAt(9999, 22, 10)).toBe(10);
  });
});

describe("edgeScrollSpeed", () => {
  it("is still in the middle of the list", () => {
    expect(edgeScrollSpeed(300, 100, 500, 26)).toBe(0);
  });

  it("scrolls up near the top and down near the bottom", () => {
    expect(edgeScrollSpeed(110, 100, 500, 26)).toBeLessThan(0);
    expect(edgeScrollSpeed(490, 100, 500, 26)).toBeGreaterThan(0);
  });

  it("creeps at the edge of the band and races at the edge of the list", () => {
    const justInside = edgeScrollSpeed(475, 100, 500, 26);
    const atTheEdge = edgeScrollSpeed(499, 100, 500, 26);

    expect(justInside).toBeGreaterThan(0);
    expect(atTheEdge).toBeGreaterThan(justInside);
  });

  it("goes no faster for a pointer dragged out of the list entirely", () => {
    // Releasing outside the window is a real gesture; it must not run away.
    expect(edgeScrollSpeed(900, 100, 500, 26)).toBe(edgeScrollSpeed(500, 100, 500, 26));
    expect(edgeScrollSpeed(-900, 100, 500, 26)).toBe(edgeScrollSpeed(100, 100, 500, 26));
  });
});
