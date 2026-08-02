/// <reference types="vitest/config" />
import process from "node:process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

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
    include: ["src/**/*.test.{ts,tsx}"],
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
