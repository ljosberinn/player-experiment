import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTheme, saveTheme } from "../../ipc";
import { DEFAULT_THEME } from "./theme";
import { type ThemePorts, useThemeStore } from "./themeStore";

vi.mock("../../ipc", () => ({
  loadTheme: vi.fn(async () => null),
  saveTheme: vi.fn(async () => undefined),
}));

const loadThemeMock = vi.mocked(loadTheme);
const saveThemeMock = vi.mocked(saveTheme);

/** A document that records what it was told, and an OS that can be posed. */
function ports(prefersDark = false, overrides: Partial<ThemePorts> = {}) {
  const listeners: (() => void)[] = [];
  const applied: string[] = [];
  const port: ThemePorts = {
    apply: (ground) => applied.push(ground),
    prefersDark: () => prefersDark,
    watch: (listener) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
    ...overrides,
  };
  return { port, applied, listeners };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadThemeMock.mockResolvedValue(null);
  saveThemeMock.mockResolvedValue(undefined);
  useThemeStore.setState({ preference: DEFAULT_THEME, ground: "light" });
});

describe("restoring at startup", () => {
  it("applies the stored preference", async () => {
    loadThemeMock.mockResolvedValue("dark");
    const { port, applied } = ports(false);

    await useThemeStore.getState().load(port);

    // Chosen dark beats an OS that asks for light.
    expect(useThemeStore.getState().preference).toBe("dark");
    expect(useThemeStore.getState().ground).toBe("dark");
    expect(applied).toEqual(["dark"]);
  });

  it("follows the OS when nothing is stored", async () => {
    const { port, applied } = ports(true);

    await useThemeStore.getState().load(port);

    expect(useThemeStore.getState().preference).toBe("system");
    expect(applied).toEqual(["dark"]);
  });

  it("still starts when the setting cannot be read", async () => {
    loadThemeMock.mockRejectedValue(new Error("database is locked"));
    const { port, applied } = ports(false);

    await expect(useThemeStore.getState().load(port)).resolves.toBeUndefined();

    // A window that never appears is a far worse failure than one on the
    // wrong ground.
    expect(applied).toEqual(["light"]);
  });
});

describe("following the OS", () => {
  it("repaints when the machine changes under a running app", async () => {
    let prefersDark = false;
    const { port, applied, listeners } = ports(false, { prefersDark: () => prefersDark });

    await useThemeStore.getState().load(port);
    expect(applied).toEqual(["light"]);

    prefersDark = true;
    for (const listener of listeners) {
      listener();
    }

    // "System" has to mean the OS now, not the OS at launch.
    expect(useThemeStore.getState().ground).toBe("dark");
    expect(applied).toEqual(["light", "dark"]);
  });

  it("stops following once the user has chosen", async () => {
    let prefersDark = false;
    const { port, applied, listeners } = ports(false, { prefersDark: () => prefersDark });

    await useThemeStore.getState().load(port);
    await useThemeStore.getState().set("light", port);

    prefersDark = true;
    for (const listener of listeners) {
      listener();
    }

    expect(useThemeStore.getState().ground).toBe("light");
    expect(applied).toEqual(["light", "light"]);
  });

  it("does not repaint when the ground has not moved", async () => {
    const { port, applied, listeners } = ports(false);

    await useThemeStore.getState().load(port);
    for (const listener of listeners) {
      listener();
    }

    // The query fires for any change to the media list, not only one that
    // flips this app's ground.
    expect(applied).toEqual(["light"]);
  });
});

describe("changing the preference", () => {
  it("applies and persists", async () => {
    const { port, applied } = ports(false);

    await useThemeStore.getState().set("dark", port);

    expect(applied).toEqual(["dark"]);
    expect(saveThemeMock).toHaveBeenCalledWith("dark");
  });

  it("resolves system against the OS", async () => {
    const { port, applied } = ports(true);

    useThemeStore.setState({ preference: "light", ground: "light" });
    await useThemeStore.getState().set("system", port);

    expect(useThemeStore.getState().ground).toBe("dark");
    expect(applied).toEqual(["dark"]);
  });

  it("does nothing when the value has not moved", async () => {
    const { port, applied } = ports(false);

    await useThemeStore.getState().set(DEFAULT_THEME, port);

    expect(applied).toEqual([]);
    expect(saveThemeMock).not.toHaveBeenCalled();
  });

  it("keeps showing what was asked for when the write fails", async () => {
    saveThemeMock.mockRejectedValue(new Error("database is locked"));
    const { port } = ports(false);

    await expect(useThemeStore.getState().set("dark", port)).resolves.toBeUndefined();

    // Snapping the control back mid-click would be a worse answer than a
    // preference that is not remembered; the next change tries again.
    expect(useThemeStore.getState().preference).toBe("dark");
  });
});
