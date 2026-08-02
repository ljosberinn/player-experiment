/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * `"true"` only in the e2e build, which is where `@wdio/tauri-plugin` gets
   * pulled in. Anything else - including unset, which is every normal build -
   * leaves that import in a statically dead branch that rollup drops, so the
   * shipped bundle never contains the test instrumentation.
   */
  readonly VITE_E2E?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
