import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { waitFor } from "storybook/test";
import { COVERS, STAGED_COVER } from "./fixtures";

/**
 * A story's answers, keyed on the command string `invoke` receives
 * (`"last_crash"`, `"plugin:dialog|open"`) rather than on the `src/ipc`
 * function that sends it.
 */
export type IpcHandlers = Record<string, (args: Record<string, unknown>) => unknown>;

/** The slots of Tauri's injected globals this file fills or wraps. */
interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;
  convertFileSrc: (path: string, protocol?: string) => string;
}

/** Events some component has subscribed to since the story began. */
let heard = new Set<string>();

/** Stands in for the Tauri runtime for one story; returns the teardown. */
export function installTauri(handlers: IpcHandlers): () => void {
  mockIPC(
    (cmd, args) => {
      const handler = handlers[cmd];
      if (handler === undefined) {
        // Thrown so the component takes its error path instead of waiting on
        // a promise that never settles; logged because some of those paths
        // swallow the error whole.
        const message = `no story handler for ${cmd}`;
        console.warn(message);
        throw new Error(message);
      }
      return handler((args ?? {}) as Record<string, unknown>);
    },
    { shouldMockEvents: true },
  );
  mockWindows("main");

  const internals = (window as unknown as { __TAURI_INTERNALS__: TauriInternals })
    .__TAURI_INTERNALS__;
  heard = new Set();
  const invoke = internals.invoke;
  internals.invoke = (cmd, args, options) => {
    if (cmd === "plugin:event|listen") {
      heard.add(String(args?.event));
    }
    return invoke(cmd, args, options);
  };
  // Not `mockConvertFileSrc`: its `cover.localhost` URLs go nowhere in a
  // browser. The trailing `#` is for `stagedCoverUrl`, which appends
  // `?v=<version>` - inside the fragment it is ignored, where in the payload
  // it would corrupt the SVG.
  internals.convertFileSrc = (path, protocol = "asset") => {
    const uri =
      protocol === "cover" ? (path === "staged" ? STAGED_COVER : COVERS[path]) : undefined;
    return uri === undefined ? "" : `${uri}#`;
  };
  return clearMocks;
}

/**
 * `emit` for a `play` function. Storybook starts `play` before the story's
 * effects have run, so an event sent straight away reaches no listener; this
 * waits for one, and fails the story if none subscribes.
 */
export async function emitEvent(event: string, payload?: unknown): Promise<void> {
  await waitFor(() => {
    if (!heard.has(event)) {
      throw new Error(`nothing listens to ${event}`);
    }
  });
  await emit(event, payload);
}
