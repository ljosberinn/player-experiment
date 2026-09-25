// The globals a story inherits from the app, in the order `main.tsx` has them.
// The sheet alone is not the app's typography - the face is imported there
// rather than from `App.css`, and without it every specimen falls back to a
// system sans and is drawn in the wrong figures.
import "@fontsource/archivo/latin-400.css";
import "@fontsource/archivo/latin-600.css";
import "@fontsource/archivo/latin-800.css";
import "../src/App.css";
// After `App.css`, which is the only reason its one rule wins.
import "./preview.css";
import type { Preview } from "@storybook/react-vite";
import { forgetListenTotals } from "../src/features/stats/listenTotals";
import { resetStores } from "./stores";
import { type IpcHandlers, installTauri } from "./tauri";

const preview: Preview = {
  /**
   * Every story starts from the stores' initial state and answers only the
   * commands its `parameters.ipc` names. Storybook merges that object with
   * any defaults set here, so a story lists only what it adds.
   */
  beforeEach: ({ parameters }) => {
    resetStores();
    // Module state like a store: kept, the next story would draw this one's totals.
    forgetListenTotals();
    return installTauri((parameters.ipc ?? {}) as IpcHandlers);
  },

  parameters: {
    // The window fill is on `html` and the frame inherits it, so a story needs
    // no ground of its own - but the default `padded` layout would inset every
    // specimen by a rem that the app never applies.
    layout: "fullscreen",
  },

  /**
   * The ground, as a toolbar switch.
   *
   * This is the thing neither test suite shows. The wdio suite measures one
   * running app, and a Vitest run applies no stylesheet at all; drawing a
   * primitive in every state on both grounds at once is what Storybook is here
   * for, and it only earns that if the ground can be flipped without a
   * restart.
   *
   * No "system" here, unlike Settings: a specimen sheet is read to compare the
   * two, so the useful control names them rather than deferring to whatever
   * the reviewer's machine happens to be set to.
   */
  globalTypes: {
    theme: {
      description: "Which ground the specimens are drawn on",
      toolbar: {
        title: "Ground",
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },

  decorators: [
    (Story, context) => {
      // The same attribute `themeStore` writes in the app, on the same
      // element - the preview iframe's own `<html>`. Anything else would be
      // drawing the specimens through a mechanism the app does not use, which
      // is how a sheet comes to disagree with the thing it documents.
      document.documentElement.setAttribute("data-theme", String(context.globals.theme));
      return Story();
    },
  ],
};

export default preview;
