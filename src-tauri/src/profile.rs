//! Chrome-format traces of the spans `span!` opens, in a `profile` build.
//!
//! Wall-clock, per thread: a scan that spends forty seconds waiting on a cold
//! disk shows as forty seconds here, where a CPU sampler shows almost nothing.
//! Open the file in <https://ui.perfetto.dev>. See `docs/knowledge/profiling.md`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tracing_chrome::{ChromeLayerBuilder, FlushGuard};
use tracing_subscriber::layer::SubscriberExt;

/// The trace being written. Dropping it closes the file.
pub struct Session {
    guard: Mutex<Option<FlushGuard>>,
    path: PathBuf,
}

impl Session {
    /// Starts writing `trace-<unix seconds>.json` into `dir` and installs the
    /// process-wide subscriber, so it can only be called once.
    pub fn start(dir: &Path) -> Self {
        let seconds = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_secs());
        let path = dir.join(format!("trace-{seconds}.json"));
        let (layer, guard) = ChromeLayerBuilder::new()
            .file(&path)
            .include_args(true)
            .build();
        tracing::subscriber::set_global_default(tracing_subscriber::registry().with(layer))
            .expect("the profile subscriber is installed once");
        Self {
            guard: Mutex::new(Some(guard)),
            path,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Writes out what is buffered and closes the trace.
    ///
    /// Explicit rather than left to `Drop`: Tauri's event loop ends the
    /// process instead of returning, so nothing in state is ever dropped.
    pub fn finish(&self) {
        if let Ok(mut guard) = self.guard.lock() {
            drop(guard.take());
        }
    }
}
