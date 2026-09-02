import { create } from "zustand";

/**
 * How long a notice stays on screen.
 *
 * Long enough to read a sentence, short enough that it is gone before it
 * becomes furniture. Dismissing it by hand is also possible.
 */
export const NOTICE_MS = 4000;

/**
 * The two ways the app says something to the user, in one place.
 *
 * Every store used to carry its own `error` and, for two of them, its own
 * `notice`, and `App` merged five of the first into one popover and three of
 * the second into one line. The merge was the tell: there is one popover and
 * one notice slot, so there is one of each here, and a feature store reports
 * into them rather than holding a copy the shell then has to reconcile.
 *
 * Deliberately not a wrapper around `ipc`: only the caller knows whether a
 * failure is worth saying anything about. The silent catches stay silent.
 */
interface StatusState {
  /** What the error popover is showing, or null when nothing is wrong. */
  message: string | null;
  /** The line above the table, or null. */
  notice: string | null;

  /**
   * Says something went wrong.
   *
   * Takes `unknown` because most callers are a `catch`, and one is a backend
   * event that hands over a string with no `catch` around it.
   *
   * One slot, last wins: the popover shows one message at a time, so a second
   * failure replaces the first rather than queueing behind it.
   */
  report: (cause: unknown) => void;
  /** Says something happened, for a moment. */
  notify: (text: string) => void;
  dismiss: () => void;
  dismissNotice: () => void;
}

export const useStatusStore = create<StatusState>((set) => ({
  message: null,
  notice: null,

  report: (cause) => set({ message: String(cause) }),
  notify: (text) => set({ notice: text }),
  dismiss: () => set({ message: null }),
  dismissNotice: () => set({ notice: null }),
}));

/** Reports `cause` from anywhere, without a hook. */
export const report = (cause: unknown): void => useStatusStore.getState().report(cause);

/** Shows `text` on the notice line from anywhere, without a hook. */
export const notify = (text: string): void => useStatusStore.getState().notify(text);

/** Clears the popover from anywhere: what an operation does as it starts. */
export const dismiss = (): void => useStatusStore.getState().dismiss();
