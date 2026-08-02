import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

// The WebdriverIO plugin has two halves, and only the Rust one was ever
// installed. Without this import nothing sets `window.__wdio_original_core__`,
// which @wdio/tauri-service polls for - in a `beforeCommand` hook, so once per
// WebDriver command - before giving up after five seconds. The suite still
// passed; it just took 328s to do it. See PLAN.md, "e2e wall time".
//
// Not awaited: the plugin polls for `window.__TAURI__.core` itself, so it does
// not need to win a race against React, and blocking first paint on test
// instrumentation would change the thing being tested.
if (import.meta.env.VITE_E2E === "true") {
  void import("@wdio/tauri-plugin");
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root is missing from index.html");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
