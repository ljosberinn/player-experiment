import { describe, expect, it, vi } from "vitest";
import {
  GLOBAL_MEDIA_KEYS,
  type GlobalShortcutPorts,
  type MediaKeyAction,
  registerMediaKeys,
  unregisterMediaKeys,
} from "./globalKeys";

function ports(overrides: Partial<GlobalShortcutPorts> = {}): GlobalShortcutPorts {
  return {
    register: vi.fn(async () => undefined),
    unregister: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("which keys are claimed", () => {
  it("registers the four media keys and nothing else", async () => {
    const p = ports();

    await registerMediaKeys(p, () => {});

    expect(vi.mocked(p.register).mock.calls.map(([accelerator]) => accelerator)).toEqual([
      "MediaPlayPause",
      "MediaTrackNext",
      "MediaTrackPrevious",
      "MediaStop",
    ]);
  });

  it("never claims Space or the arrow keys", () => {
    // A global shortcut is exclusive: registering Space would stop the space
    // bar working in every other application on the machine. The in-window
    // bindings cover those, and this list must not grow into them.
    const claimed = GLOBAL_MEDIA_KEYS.map((key) => key.accelerator);

    for (const forbidden of ["Space", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      expect(claimed).not.toContain(forbidden);
    }
  });

  it("maps each key to the action its label promises", async () => {
    const fired: MediaKeyAction[] = [];
    const handlers: Array<() => void> = [];
    const p = ports({
      register: vi.fn(async (_accelerator, handler) => {
        handlers.push(handler);
      }),
    });

    await registerMediaKeys(p, (action) => fired.push(action));
    for (const handler of handlers) {
      handler();
    }

    expect(fired).toEqual(["toggle", "next", "previous", "stop"]);
  });
});

describe("when a key is already taken", () => {
  it("keeps the others rather than giving up on all four", async () => {
    // Registered one at a time for exactly this reason: the plugin's array
    // form is all-or-nothing, so one busy key would cost the other three.
    const p = ports({
      register: vi.fn(async (accelerator) => {
        if (accelerator === "MediaPlayPause") {
          throw new Error("HotKey already registered");
        }
      }),
    });

    const claimed = await registerMediaKeys(p, () => {});

    expect(claimed).toEqual(["MediaTrackNext", "MediaTrackPrevious", "MediaStop"]);
  });

  it("does not treat it as an error", async () => {
    // Another media player holding the key is not a fault condition, and not
    // worth a banner over someone's library.
    const p = ports({
      register: vi.fn(async () => {
        throw new Error("HotKey already registered");
      }),
    });

    await expect(registerMediaKeys(p, () => {})).resolves.toEqual([]);
  });
});

describe("releasing the keys", () => {
  it("releases exactly what was claimed", async () => {
    const p = ports({
      register: vi.fn(async (accelerator) => {
        if (accelerator === "MediaStop") {
          throw new Error("taken");
        }
      }),
    });

    const claimed = await registerMediaKeys(p, () => {});
    await unregisterMediaKeys(p, claimed);

    // Not the whole list: releasing a key this app never held could take it
    // from whichever application does.
    expect(vi.mocked(p.unregister).mock.calls.map(([accelerator]) => accelerator)).toEqual([
      "MediaPlayPause",
      "MediaTrackNext",
      "MediaTrackPrevious",
    ]);
  });

  it("carries on when one release fails", async () => {
    const p = ports({
      unregister: vi.fn(async (accelerator) => {
        if (accelerator === "MediaPlayPause") {
          throw new Error("not registered");
        }
      }),
    });

    // This runs during teardown; throwing there would be noise at the least
    // useful moment, and would strand the keys after it.
    await expect(
      unregisterMediaKeys(p, ["MediaPlayPause", "MediaTrackNext"]),
    ).resolves.toBeUndefined();
    expect(p.unregister).toHaveBeenCalledTimes(2);
  });
});
