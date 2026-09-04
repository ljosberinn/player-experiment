import { browser } from "@wdio/globals";

/**
 * Calling a Tauri command from a test.
 *
 * Used sparingly and only where the UI has no route a driver can take: the
 * button that adds a watch folder opens the OS folder picker, and a hundred
 * and fifty thousand rows have no button at all. Everything a user can click,
 * the specs click.
 */

declare global {
  interface Window {
    __TAURI__?: {
      core: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
      /** Used by `emit` below to stand in for a producer the driver has none of. */
      event?: { emit: (event: string, payload?: unknown) => Promise<void> };
      /** Used by `viewport.ts` to zoom for a screenshot without persisting it. */
      webview?: { getCurrentWebview: () => { setZoom: (factor: number) => Promise<void> } };
    };
    /** Where `invoke` parks a result until the poll below collects it. */
    __e2eInvoke?: { done: boolean; value?: unknown; error?: string };
  }
}

/**
 * Runs `command` in the app and waits for it to settle.
 *
 * Started and collected in two steps rather than with `executeAsync`, which is
 * deprecated in WebdriverIO 9 and needs `/execute/async` on the driver. The
 * driver here is a Tauri plugin embedded in the app rather than a full browser
 * driver, and plain `execute` is what the rest of the suite already proves it
 * supports.
 */
export async function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
  timeout = 120_000,
): Promise<T> {
  await browser.execute(
    (cmd: string, payload: Record<string, unknown>) => {
      const box: NonNullable<Window["__e2eInvoke"]> = { done: false };
      window.__e2eInvoke = box;

      const tauri = window.__TAURI__;
      if (tauri === undefined) {
        box.error = "window.__TAURI__ is missing - is withGlobalTauri set?";
        box.done = true;
        return;
      }

      tauri.core.invoke(cmd, payload).then(
        (value) => {
          box.value = value;
          box.done = true;
        },
        (cause) => {
          box.error = String(cause);
          box.done = true;
        },
      );
    },
    command,
    args,
  );

  await browser.waitUntil(
    async () => (await browser.execute(() => window.__e2eInvoke))?.done === true,
    { timeout, timeoutMsg: `${command} never settled` },
  );

  const result = await browser.execute(() => window.__e2eInvoke);
  if (result?.error !== undefined) {
    throw new Error(`${command} failed: ${result.error}`);
  }
  return result?.value as T;
}

/**
 * Sends `event` as though the backend had, and waits for the round trip.
 *
 * For a channel whose producer a spec cannot start. The unattended lookup pass
 * is the only thing that reports on `task://progress`, it needs the network and
 * it runs for the better part of two days - so the readout it feeds is
 * photographed against a payload rather than against a real pass. What is under
 * test is the subscription, the formatting and the layout, which is all of it
 * bar the arithmetic the Rust tests cover.
 *
 * Tauri routes an emit from the webview through the backend and back out to
 * every listener, this one included, so the component hears it exactly as it
 * hears the real thing.
 */
export async function emit(event: string, payload: unknown): Promise<void> {
  const failure = await browser.execute(
    async (name: string, body: unknown) => {
      const tauri = window.__TAURI__;
      if (tauri?.event === undefined) {
        return "window.__TAURI__.event is missing - is withGlobalTauri set?";
      }
      try {
        await tauri.event.emit(name, body);
        return null;
      } catch (cause) {
        return String(cause);
      }
    },
    event,
    payload,
  );
  if (failure !== null) {
    throw new Error(`${event} could not be emitted: ${failure}`);
  }
}
