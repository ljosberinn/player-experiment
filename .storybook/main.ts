import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],

  /**
   * The builder merges `vite.config.ts`, and nothing in it has to come back
   * off - which is worth stating, because both halves of it look like they
   * would.
   *
   * `build` never arrives: the builder destructures the user config and keeps
   * only `build.target`, so the `onwarn` handler that makes every build warning
   * an error is not in force here. That is the right outcome rather than a
   * lucky one - a Storybook build ships nothing, and its virtual modules and
   * runtime are not code this project can act on. The chunk-size warning it
   * prints is one such.
   *
   * `server` is merged and then replaced: the dev server runs in
   * `middlewareMode` behind Storybook's own, so the port 1420 `strictPort` pin
   * that Tauri needs is dropped and `npm run dev` and this can both be up.
   *
   * What does carry over is the part that should: the React plugin, and with it
   * React Compiler at `panicThreshold: "all_errors"`. A story that breaks the
   * rules of React fails this build the way a component fails the app's.
   */
  core: {
    // A local-first player that forbids network access in its own CSP should
    // not phone home from its component library either.
    disableTelemetry: true,
  },
};

export default config;
