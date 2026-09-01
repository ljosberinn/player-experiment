/// <reference types="vitest/config" />
import process from "node:process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      /**
       * React Compiler, through the plugin's own oxc port rather than Babel -
       * one dev dependency instead of three, and no second transform pass over
       * every `.tsx` in a toolchain that is otherwise oxc-only.
       */
      compiler: {
        /**
         * A component the compiler cannot compile is skipped silently, and
         * nothing else in this repo would report it: Biome has no
         * react-compiler rule and there is no ESLint. Failing the build is the
         * only channel left - the same stance, and the same cost, as `onwarn`
         * below.
         */
        panicThreshold: "all_errors",
        environment: {
          /**
           * Function outlining hoists a closure that captures nothing to
           * module scope, which gives every instance of the component the same
           * function *identity*. Five hooks here hand a handler that captures
           * nothing to `addEventListener`, and that API deduplicates by
           * identity: two mounted components registered one listener between
           * them, and the first unmount took it away from both. Caught by
           * `usePlayerShortcuts.test.tsx`'s "unbinds on unmount".
           */
          enableFunctionOutlining: false,
        },
      },
    }),
  ],

  build: {
    rollupOptions: {
      /**
       * Build warnings are errors.
       *
       * A warning here only ever appears in a build log, and the production
       * build runs inside `tauri build` in the e2e job, where it scrolls past
       * in a nine-minute transcript and fails nothing. That is how a pointless
       * dynamic import sat in the tree from phase 9 until someone read the
       * output by eye.
       *
       * If a warning ever turns out to be one we genuinely accept, silence
       * that specific `warning.code` here with a comment saying why - do not
       * loosen this back to the default handler.
       */
      onwarn(warning) {
        // The one accepted exception, added with Base UI in phase 24: a
        // circular import *inside a dependency*. Base UI's popup store and its
        // Floating UI root context import each other, which is that library's
        // internal structure and nothing this project can act on - and the
        // bundler resolves it. Our own code is still held to the rule: the
        // check is on where the cycle is, not on the code alone.
        const insideDependency = (warning.ids ?? []).every((id) => id.includes("node_modules"));
        if (warning.code === "CIRCULAR_DEPENDENCY" && insideDependency) {
          return;
        }
        // The second, added with React Compiler in phase 65: the compiler
        // refuses to memoize a component holding a `useVirtualizer`, because
        // TanStack Virtual hands back functions whose identity changes without
        // the instance's. Nothing this project can act on either - the two
        // components say so with `"use no memo"`, which demotes the bailout to
        // this warning but does not stop the plugin logging it. Every other
        // compiler diagnostic is a rules-of-React violation and still throws.
        if (
          warning.code === "PLUGIN_WARNING" &&
          warning.plugin === "vite:react-compiler" &&
          warning.message.includes("react-compiler(IncompatibleLibrary)")
        ) {
          return;
        }
        throw new Error(
          `Build warning (${warning.code ?? "unknown"}): ${warning.message}
` + "Warnings fail the build on purpose - see vite.config.ts.",
        );
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    ...(host ? { hmr: { protocol: "ws" as const, host, port: 1421 } } : {}),
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // The e2e directory is WebdriverIO territory, with one exception: the
    // screenshot viewport arithmetic is pure and belongs in a unit run. The
    // `.unit.` infix and the single-level glob both keep this away from the
    // specs under `e2e/specs`, which need a browser and a built app.
    include: ["src/**/*.test.{ts,tsx}", "e2e/*.unit.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/ipc/bindings/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
