import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateHandle, UpdaterPorts } from "./store";
import { useUpdaterStore } from "./store";

function ports(over: Partial<UpdaterPorts> = {}): UpdaterPorts {
  return {
    check: vi.fn(async () => null),
    ...over,
  };
}

/** An update the backend says is available. */
function available(version = "0.3.0", over: Partial<UpdateHandle> = {}) {
  return {
    version,
    download: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    ...over,
  };
}

const initial = useUpdaterStore.getState();

beforeEach(() => {
  useUpdaterStore.setState({
    ...initial,
    status: "idle",
    version: null,
    error: null,
    update: null,
  });
});

describe("the updater", () => {
  it("says nothing when there is nothing to install", async () => {
    const p = ports();

    await useUpdaterStore.getState().check(p);

    // The common case by far. It must leave no trace in the UI.
    expect(useUpdaterStore.getState().status).toBe("idle");
    expect(useUpdaterStore.getState().version).toBeNull();
  });

  it("downloads without asking, then offers the restart", async () => {
    const update = available("0.3.0");
    const p = ports({ check: vi.fn(async () => update) });

    await useUpdaterStore.getState().check(p);

    // Downloading needs no decision, and asking first only means the user
    // waits after saying yes.
    expect(update.download).toHaveBeenCalled();
    expect(useUpdaterStore.getState()).toMatchObject({ status: "ready", version: "0.3.0" });
  });

  it("never installs on its own", async () => {
    const update = available("0.3.0");

    await useUpdaterStore.getState().check(ports({ check: vi.fn(async () => update) }));

    // The whole point of the phase. Installing hands off to the NSIS installer
    // and exits the process, so a check that installed would end the app - and
    // whatever was playing - without anybody asking for it.
    expect(update.install).not.toHaveBeenCalled();
  });

  it("stays quiet when the check fails", async () => {
    const p = ports({
      check: vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    });

    await useUpdaterStore.getState().check(p);

    // Being offline is the ordinary case, not a fault worth reporting. The
    // state is kept so a later tick can retry.
    expect(useUpdaterStore.getState().status).toBe("failed");
    expect(useUpdaterStore.getState().version).toBeNull();
  });

  it("stays quiet when the download fails half way", async () => {
    const update = available("0.3.0", {
      download: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });

    await useUpdaterStore.getState().check(ports({ check: vi.fn(async () => update) }));

    // A partial download must not leave an "install" button pointing at
    // nothing, and it is still not news worth interrupting anyone over.
    expect(useUpdaterStore.getState().status).toBe("failed");
    expect(useUpdaterStore.getState().update).toBeNull();
  });

  it("retries after a failure but not while one is in flight", async () => {
    const check = vi.fn(async () => null);

    useUpdaterStore.setState({ status: "failed" });
    await useUpdaterStore.getState().check(ports({ check }));
    expect(check).toHaveBeenCalledOnce();

    useUpdaterStore.setState({ status: "downloading" });
    await useUpdaterStore.getState().check(ports({ check }));
    // A timer tick must not restart a download that is already running.
    expect(check).toHaveBeenCalledOnce();
  });

  it("does not check again once an update is ready", async () => {
    const check = vi.fn(async () => null);
    useUpdaterStore.setState({ status: "ready", version: "0.3.0" });

    await useUpdaterStore.getState().check(ports({ check }));

    // Re-checking would throw away a finished download for no gain.
    expect(check).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().status).toBe("ready");
  });

  it("installs the update it downloaded when asked", async () => {
    const update = available("0.3.0");
    useUpdaterStore.setState({ status: "ready", version: "0.3.0", update });

    await useUpdaterStore.getState().install();

    expect(update.install).toHaveBeenCalled();
    expect(useUpdaterStore.getState().status).toBe("installing");
  });

  it("installs nothing that is not ready", async () => {
    const update = available("0.3.0");
    useUpdaterStore.setState({ status: "downloading", update });

    await useUpdaterStore.getState().install();

    expect(update.install).not.toHaveBeenCalled();
  });

  it("installs nothing when there is no download to install", async () => {
    // `ready` without a handle should be unreachable, but the button is driven
    // by the status alone, so it must not throw its way through the click.
    useUpdaterStore.setState({ status: "ready", version: "0.3.0", update: null });

    await expect(useUpdaterStore.getState().install()).resolves.toBeUndefined();
    expect(useUpdaterStore.getState().status).toBe("ready");
  });

  it("stays offerable when the install fails", async () => {
    const update = available("0.3.0", {
      install: vi.fn(async () => {
        throw new Error("denied");
      }),
    });
    useUpdaterStore.setState({ status: "ready", version: "0.3.0", update });

    await useUpdaterStore.getState().install();

    // Returning at all means it failed - a successful install never comes
    // back. The download is still held, so the offer stays up.
    expect(useUpdaterStore.getState().status).toBe("ready");
    expect(useUpdaterStore.getState().error).toContain("denied");
  });
});
