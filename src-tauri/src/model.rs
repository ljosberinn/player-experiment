use serde::Serialize;
use ts_rs::TS;

/// Types shared with the frontend live here and derive [`TS`], so the
/// TypeScript definitions in `src/ipc/bindings/` are generated, never written
/// by hand.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}
