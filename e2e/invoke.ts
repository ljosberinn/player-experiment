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
