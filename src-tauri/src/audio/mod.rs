//! Playback.
//!
//! [`engine`] holds the behaviour, [`sink`] holds the hardware, and this
//! module is the thread that joins them: it owns the engine, drains a command
//! channel, ticks on a timer, and hands every resulting event to a callback
//! the caller supplies. Nothing here knows about Tauri or SQLite - the wiring
//! to both lives in `lib.rs`.

pub mod engine;
pub mod sink;

use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::error::{AppError, AppResult};

pub use engine::{Command, EngineState, Event, QueueEntry};
pub use sink::{AudioSink, RodioSink};

/// How often the engine is ticked.
///
/// Doubles as the position event rate (4/s, enough for a smooth scrubber) and
/// as the worst-case delay before a finished track advances the queue.
const TICK: Duration = Duration::from_millis(250);

/// Handle to the player thread.
///
/// Commands are fire-and-forget: the UI never waits on audio, it reacts to the
/// events that follow. The last state is mirrored here so a newly opened
/// window can ask what is playing without waiting for the next change.
pub struct Player {
    commands: Sender<Command>,
    state: Arc<Mutex<EngineState>>,
}

impl Player {
    /// Starts the player thread.
    ///
    /// `on_event` runs on that thread, so it must not block for long: it is
    /// the same thread that advances the queue.
    pub fn spawn<S, F>(sink: S, volume: f32, muted: bool, mut on_event: F) -> Self
    where
        S: AudioSink + 'static,
        F: FnMut(&Event, &EngineState) + Send + 'static,
    {
        let (commands, rx) = mpsc::channel::<Command>();
        let mut engine = engine::Engine::new(sink, volume, muted);
        let state = Arc::new(Mutex::new(engine.state()));
        let shared = Arc::clone(&state);

        std::thread::Builder::new()
            .name("player".to_owned())
            .spawn(move || loop {
                let events = match rx.recv_timeout(TICK) {
                    Ok(command) => engine.handle(command),
                    Err(RecvTimeoutError::Timeout) => engine.tick(),
                    // Every sender is gone, so the app is shutting down.
                    Err(RecvTimeoutError::Disconnected) => return,
                };

                if events.is_empty() {
                    continue;
                }
                let current = engine.state();
                if let Ok(mut guard) = shared.lock() {
                    guard.clone_from(&current);
                }
                for event in &events {
                    on_event(event, &current);
                }
            })
            .expect("spawning the player thread");

        Self { commands, state }
    }

    /// Queues a command for the player thread.
    ///
    /// Fails only if that thread has gone away, which the UI reports rather
    /// than treating as fatal.
    pub fn send(&self, command: Command) -> AppResult<()> {
        self.commands
            .send(command)
            .map_err(|_| AppError::Internal("the player thread is not running".to_owned()))
    }

    /// The last state the engine reported.
    pub fn state(&self) -> EngineState {
        match self.state.lock() {
            Ok(guard) => guard.clone(),
            // A poisoned lock means the player thread panicked mid-update.
            // Reporting a stopped player is better than propagating a panic
            // into every command.
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::PlaybackStatus;
    use std::sync::mpsc::channel;

    // `sink::SilentSink` - a sink that reports itself as loaded, so the thread
    // can be driven without an audio device. It used to be declared here as
    // well; it now lives beside the other sinks because the e2e build needs
    // one too.
    use sink::SilentSink;

    #[test]
    fn commands_reach_the_engine_and_events_come_back() {
        let (tx, rx) = channel();
        let player = Player::spawn(SilentSink::default(), 1.0, false, move |event, state| {
            let _ = tx.send((event.clone(), state.clone()));
        });

        player
            .send(Command::SetQueue {
                entries: vec![QueueEntry {
                    track_id: 1,
                    path: "C:\\music\\1.mp3".to_owned(),
                    duration_ms: 1000,
                }],
                index: 0,
            })
            .unwrap();

        // A successful load reports the track that opened before it reports
        // the new state, so this is the second event through the channel.
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap().0,
            Event::Loaded(1)
        );

        let (event, state) = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(event, Event::StateChanged);
        assert_eq!(state.status, PlaybackStatus::Playing);
        assert_eq!(state.track_id, Some(1));
    }

    #[test]
    fn the_mirrored_state_tracks_the_engine() {
        let (tx, rx) = channel();
        let player = Player::spawn(SilentSink::default(), 0.3, false, move |_, _| {
            let _ = tx.send(());
        });

        assert_eq!(player.state().status, PlaybackStatus::Stopped);
        assert_eq!(player.state().volume, 0.3);

        player.send(Command::SetVolume(0.9)).unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(player.state().volume, 0.9);
    }

    #[test]
    fn a_player_started_muted_reports_itself_muted() {
        // What a window opening after a restart asks for: the mute the last
        // session left behind is in the state before any command arrives.
        let player = Player::spawn(SilentSink::default(), 0.3, true, |_, _| {});

        assert!(player.state().muted);
        assert_eq!(player.state().volume, 0.3);
        assert!(!player.state().repeat_one);
    }
}
