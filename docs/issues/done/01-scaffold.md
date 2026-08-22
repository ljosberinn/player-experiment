# 1 — Scaffold and the CI gate

Merged in #1.

Tauri v2 + React 19 + TypeScript + Vite, Biome, Vitest, `cargo` lint and test,
cargo-deny, and the four-job CI workflow that has gated every PR since.

- The `commands/` seam and the `ts-rs` → `src/ipc/bindings/` pipeline were set up
  here, along with the CI check that committed bindings match the Rust types.
- `.githooks/` and the `prepare` script date from here.
- `@tanstack/react-table` was added here and never imported — the table ended up
  hand-rolled. Removed in [42](../upcoming/42-dependency-maintenance.md).
