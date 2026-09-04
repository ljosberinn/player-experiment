/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * `"true"` only in the e2e build, which is where `@wdio/tauri-plugin` gets
   * pulled in. Anything else - including unset, which is every normal build -
   * leaves that import in a statically dead branch that rollup drops, so the
   * shipped bundle never contains the test instrumentation.
   */
  readonly VITE_E2E?: string;

  /**
   * `"true"` only under `npm run dev:scan`, which is where react-scan's render
   * overlay gets pulled in. Anything else - including unset, which is every
   * normal `npm run dev` - leaves that import unreached. It is paired with
   * `DEV` rather than trusted alone, so a build that inherits this from its
   * environment still leaves the import in a statically dead branch that rollup
   * drops.
   */
  readonly VITE_SCAN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
