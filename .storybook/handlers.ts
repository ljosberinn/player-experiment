import { CRASH } from "./fixtures";
import type { IpcHandlers } from "./tauri";

export const crashHandlers: IpcHandlers = {
  last_crash: () => CRASH,
  acknowledge_crash: () => null,
  reveal_crash_log: () => null,
};
