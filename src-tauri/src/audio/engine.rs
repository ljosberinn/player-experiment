//! The playback state machine.
//!
//! All of the behaviour worth testing lives here - what "next" means at the
//! end of a queue, when a play is counted, what happens to a queue when one
//! file will not decode - and none of it touches hardware: the engine talks to
//! an [`AudioSink`], which is a fake in tests.
//!
//! The engine is passive. It never blocks and never sleeps; the owning thread
//! calls [`Engine::tick`] on a timer and forwards whatever comes back.

use std::path::Path;
use std::time::Duration;

use crate::model::PlaybackStatus;

use super::sink::AudioSink;

/// One entry of the play queue: what the engine needs to play a track without
/// going back to the database.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueEntry {
    pub track_id: i64,
    pub path: String,
    pub duration_ms: i64,
}

/// Everything the engine can be asked to do.
#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    /// Replaces the queue and starts playing at `index`.
    SetQueue {
        entries: Vec<QueueEntry>,
        index: usize,
    },
    /// Play if paused or stopped, pause if playing.
    Toggle,
    Pause,
    Resume,
    Stop,
    Next,
    Previous,
    Seek {
        position_ms: i64,
    },
    SetVolume(f32),
    /// Silence without forgetting the level. See [`Engine::muted`].
    SetMuted(bool),
    /// Play the current track forever instead of advancing at its end.
    SetRepeatOne(bool),
}

/// Something the owning thread should act on.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// The snapshot changed; re-emit it. Deliberately payload-free so the
    /// engine never has to know about database rows.
    StateChanged,
    Position {
        position_ms: i64,
        duration_ms: i64,
    },
    /// This track passed the "counts as played" threshold. Emitted at most
    /// once per load.
    Played(i64),
    /// Non-fatal: playback carried on or stopped cleanly, and the user is told.
    Error(String),
    /// This track would not open, so the file is gone or unreadable. The owner
    /// marks it missing - a failed play is a cheaper signal than a scan, and
    /// arrives at the moment the user finds out anyway.
    LoadFailed(i64),
    /// This track opened. The mirror of `LoadFailed`: a file that plays is a
    /// file that is there, so any mark on it is stale and the owner clears it
    /// without waiting for a scan.
    Loaded(i64),
}

/// The engine's view of itself. The thread turns this into a
/// [`crate::model::PlayerSnapshot`] by looking up the current track.
#[derive(Debug, Clone, PartialEq)]
pub struct EngineState {
    pub status: PlaybackStatus,
    pub track_id: Option<i64>,
    pub queue_index: Option<u32>,
    pub queue_len: u32,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub volume: f32,
    pub muted: bool,
    pub repeat_one: bool,
}

/// Fraction of a track that has to play before it counts as played.
///
/// Matches the last.fm scrobbling rule the plan calls for, so the two never
/// disagree about what "played" means.
const PLAYED_FRACTION: f64 = 0.5;

/// How far into a track "previous" restarts it instead of stepping back, the
/// behaviour every CD player and iTunes has had.
const PREVIOUS_RESTART_AFTER: Duration = Duration::from_secs(3);

/// How many files in a row may fail to load before the engine gives up.
///
/// Skipping past a broken file is what a user wants; skipping past forty
/// thousand of them silently is not.
const MAX_CONSECUTIVE_LOAD_FAILURES: usize = 5;

pub struct Engine<S: AudioSink> {
    sink: S,
    queue: Vec<QueueEntry>,
    index: Option<usize>,
    status: PlaybackStatus,
    volume: f32,
    /// Silence, held apart from a volume of zero.
    ///
    /// Two different intentions - "I have turned this down" and "shut up for a
    /// moment" - and unmuting has to tell them apart, which it can only do if
    /// the level it should come back to is still here. So the sink hears
    /// [`Self::output_volume`] while `volume` keeps saying what the rail shows.
    muted: bool,
    /// Whether the end of the current track loops back to its start.
    repeat_one: bool,
    /// Whether the current load has already been counted as played.
    counted: bool,
    last_position_ms: i64,
}

impl<S: AudioSink> Engine<S> {
    pub fn new(sink: S, volume: f32, muted: bool) -> Self {
        let volume = clamp_volume(volume);
        let mut engine = Self {
            sink,
            queue: Vec::new(),
            index: None,
            status: PlaybackStatus::Stopped,
            volume,
            muted,
            repeat_one: false,
            counted: false,
            last_position_ms: 0,
        };
        let output = engine.output_volume();
        engine.sink.set_volume(output);
        engine
    }

    /// What the sink is actually set to: the level, or silence while muted.
    fn output_volume(&self) -> f32 {
        if self.muted {
            0.0
        } else {
            self.volume
        }
    }

    pub fn state(&self) -> EngineState {
        EngineState {
            status: self.status,
            track_id: self.current().map(|entry| entry.track_id),
            queue_index: self.index.map(|index| index as u32),
            queue_len: self.queue.len() as u32,
            position_ms: self.position_ms(),
            duration_ms: self.current().map_or(0, |entry| entry.duration_ms),
            volume: self.volume,
            muted: self.muted,
            repeat_one: self.repeat_one,
        }
    }

    fn current(&self) -> Option<&QueueEntry> {
        self.index.and_then(|index| self.queue.get(index))
    }

    fn position_ms(&self) -> i64 {
        if self.status == PlaybackStatus::Stopped {
            return 0;
        }
        i64::try_from(self.sink.position().as_millis()).unwrap_or(i64::MAX)
    }

    /// Dispatch only: every arm is one line, so the behaviour of a command can
    /// be read - and driven from a test - without picking it out of a match.
    pub fn handle(&mut self, command: Command) -> Vec<Event> {
        match command {
            Command::SetQueue { entries, index } => self.set_queue(entries, index),
            Command::Toggle => self.toggle(),
            Command::Pause => self.pause(),
            Command::Resume => self.resume(),
            Command::Stop => self.stop(),
            Command::Next => self.step(1),
            Command::Previous => self.previous(),
            Command::Seek { position_ms } => self.seek(position_ms),
            Command::SetVolume(volume) => self.set_volume(volume),
            Command::SetMuted(muted) => self.set_muted(muted),
            Command::SetRepeatOne(repeat) => self.set_repeat_one(repeat),
        }
    }

    fn set_queue(&mut self, entries: Vec<QueueEntry>, index: usize) -> Vec<Event> {
        if entries.is_empty() {
            return self.stop();
        }
        let index = index.min(entries.len() - 1);
        self.queue = entries;
        self.start(index)
    }

    fn toggle(&mut self) -> Vec<Event> {
        match self.status {
            PlaybackStatus::Playing => self.pause(),
            PlaybackStatus::Paused => self.resume(),
            // Nothing loaded but a queue remembered: pick up where the user
            // left off rather than doing nothing.
            PlaybackStatus::Stopped => {
                match self
                    .index
                    .or(if self.queue.is_empty() { None } else { Some(0) })
                {
                    Some(index) => self.start(index),
                    None => Vec::new(),
                }
            }
        }
    }

    fn previous(&mut self) -> Vec<Event> {
        if self.status != PlaybackStatus::Stopped && self.sink.position() >= PREVIOUS_RESTART_AFTER
        {
            return self.seek(0);
        }
        self.step(-1)
    }

    fn set_volume(&mut self, volume: f32) -> Vec<Event> {
        self.volume = clamp_volume(volume);
        // Moving the rail is asking to hear something, so it lifts a mute
        // rather than sliding silently under one. The alternative is a fill
        // that follows the pointer over a player that stays silent, with
        // nothing on screen saying why.
        self.muted = false;
        let output = self.output_volume();
        self.sink.set_volume(output);
        vec![Event::StateChanged]
    }

    fn set_muted(&mut self, muted: bool) -> Vec<Event> {
        if self.muted == muted {
            return Vec::new();
        }
        self.muted = muted;
        let output = self.output_volume();
        self.sink.set_volume(output);
        vec![Event::StateChanged]
    }

    fn set_repeat_one(&mut self, repeat: bool) -> Vec<Event> {
        if self.repeat_one == repeat {
            return Vec::new();
        }
        self.repeat_one = repeat;
        vec![Event::StateChanged]
    }

    /// Called on a timer: advances the queue when a track runs out and reports
    /// the playhead.
    pub fn tick(&mut self) -> Vec<Event> {
        if self.status != PlaybackStatus::Playing {
            return Vec::new();
        }

        let mut events = Vec::new();
        let position_ms = self.position_ms();
        let duration_ms = self.current().map_or(0, |entry| entry.duration_ms);

        if let Some(event) = self.count_play_if_due(position_ms, duration_ms) {
            events.push(event);
        }

        if self.sink.finished() {
            events.extend(self.finished());
            return events;
        }

        if position_ms != self.last_position_ms {
            self.last_position_ms = position_ms;
            events.push(Event::Position {
                position_ms,
                duration_ms,
            });
        }
        events
    }

    fn count_play_if_due(&mut self, position_ms: i64, duration_ms: i64) -> Option<Event> {
        if self.counted || duration_ms <= 0 {
            return None;
        }
        let threshold = (duration_ms as f64 * PLAYED_FRACTION) as i64;
        if position_ms < threshold {
            return None;
        }
        self.counted = true;
        self.current().map(|entry| Event::Played(entry.track_id))
    }

    /// What a track running out of audio means.
    ///
    /// With repeat on it means this song again, from the top - `start` on the
    /// same index rather than a seek to zero, because reloading is also what
    /// clears `counted`, and **every loop is a play**: a song left on repeat
    /// for an hour has been played, and recording that once would make Most
    /// Played wrong in the case it matters most. `Next` is unaffected: asking
    /// for the next song is not the same as reaching the end of this one.
    fn finished(&mut self) -> Vec<Event> {
        match (self.repeat_one, self.index) {
            (true, Some(index)) => self.start(index),
            _ => self.step(1),
        }
    }

    /// Loads and plays `index`, skipping over files that will not open.
    fn start(&mut self, index: usize) -> Vec<Event> {
        let mut events = Vec::new();
        let mut index = index;
        let mut failures = 0;

        loop {
            let Some(entry) = self.queue.get(index) else {
                events.extend(self.stop());
                return events;
            };

            match self.sink.load(Path::new(&entry.path)) {
                Ok(()) => {
                    self.sink.play();
                    self.index = Some(index);
                    self.status = PlaybackStatus::Playing;
                    self.counted = false;
                    self.last_position_ms = 0;
                    events.push(Event::Loaded(entry.track_id));
                    events.push(Event::StateChanged);
                    return events;
                }
                Err(message) => {
                    events.push(Event::LoadFailed(entry.track_id));
                    events.push(Event::Error(message));
                    failures += 1;
                    if failures >= MAX_CONSECUTIVE_LOAD_FAILURES {
                        events.extend(self.stop());
                        return events;
                    }
                    index += 1;
                }
            }
        }
    }

    /// Moves `delta` entries through the queue. Running off either end stops.
    fn step(&mut self, delta: isize) -> Vec<Event> {
        let Some(current) = self.index else {
            return self.stop();
        };
        match usize::try_from(current as isize + delta) {
            Ok(next) if next < self.queue.len() => self.start(next),
            _ => self.stop(),
        }
    }

    fn pause(&mut self) -> Vec<Event> {
        if self.status != PlaybackStatus::Playing {
            return Vec::new();
        }
        self.sink.pause();
        self.status = PlaybackStatus::Paused;
        vec![Event::StateChanged]
    }

    fn resume(&mut self) -> Vec<Event> {
        if self.status != PlaybackStatus::Paused {
            return Vec::new();
        }
        self.sink.play();
        self.status = PlaybackStatus::Playing;
        vec![Event::StateChanged]
    }

    fn stop(&mut self) -> Vec<Event> {
        if self.status == PlaybackStatus::Stopped {
            return Vec::new();
        }
        self.sink.stop();
        self.status = PlaybackStatus::Stopped;
        self.last_position_ms = 0;
        self.counted = false;
        // `index` is kept: it is where Toggle resumes from.
        vec![Event::StateChanged]
    }

    fn seek(&mut self, position_ms: i64) -> Vec<Event> {
        let Some(duration_ms) = self.current().map(|entry| entry.duration_ms) else {
            return Vec::new();
        };
        if self.status == PlaybackStatus::Stopped {
            return Vec::new();
        }

        // Clamped rather than rejected: the scrubber can hand us a position
        // past the end through rounding, and that should mean "the end".
        let position_ms = position_ms.clamp(0, duration_ms.max(0));
        match self.sink.seek(Duration::from_millis(position_ms as u64)) {
            Ok(()) => {
                self.last_position_ms = position_ms;
                vec![
                    Event::Position {
                        position_ms,
                        duration_ms,
                    },
                    Event::StateChanged,
                ]
            }
            Err(message) => vec![Event::Error(message)],
        }
    }
}

fn clamp_volume(volume: f32) -> f32 {
    if volume.is_nan() {
        return 0.0;
    }
    volume.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::sink::FakeSink;

    fn entry(id: i64, duration_ms: i64) -> QueueEntry {
        QueueEntry {
            track_id: id,
            path: format!("C:\\music\\{id}.mp3"),
            duration_ms,
        }
    }

    fn engine_with(count: i64) -> Engine<FakeSink> {
        let mut engine = Engine::new(FakeSink::default(), 1.0, false);
        engine.handle(Command::SetQueue {
            entries: (1..=count).map(|id| entry(id, 200_000)).collect(),
            index: 0,
        });
        engine
    }

    #[test]
    fn setting_a_queue_plays_the_requested_index() {
        let mut engine = Engine::new(FakeSink::default(), 1.0, false);
        let events = engine.handle(Command::SetQueue {
            entries: vec![entry(1, 1000), entry(2, 1000), entry(3, 1000)],
            index: 1,
        });

        // `Loaded` first: the file opened, which is what clears a stale
        // missing mark, and only then is there a new state to report.
        assert_eq!(events, vec![Event::Loaded(2), Event::StateChanged]);
        let state = engine.state();
        assert_eq!(state.status, PlaybackStatus::Playing);
        assert_eq!(state.track_id, Some(2));
        assert_eq!(state.queue_index, Some(1));
        assert_eq!(state.queue_len, 3);
    }

    #[test]
    fn an_out_of_range_start_index_clamps_to_the_last_entry() {
        let mut engine = Engine::new(FakeSink::default(), 1.0, false);
        engine.handle(Command::SetQueue {
            entries: vec![entry(1, 1000), entry(2, 1000)],
            index: 99,
        });
        assert_eq!(engine.state().track_id, Some(2));
    }

    #[test]
    fn an_empty_queue_stops_instead_of_panicking() {
        let mut engine = engine_with(2);
        engine.handle(Command::SetQueue {
            entries: Vec::new(),
            index: 0,
        });
        assert_eq!(engine.state().status, PlaybackStatus::Stopped);
    }

    #[test]
    fn toggle_walks_playing_paused_playing() {
        let mut engine = engine_with(1);
        assert_eq!(engine.state().status, PlaybackStatus::Playing);

        engine.handle(Command::Toggle);
        assert_eq!(engine.state().status, PlaybackStatus::Paused);

        engine.handle(Command::Toggle);
        assert_eq!(engine.state().status, PlaybackStatus::Playing);
    }

    #[test]
    fn toggle_after_stop_resumes_the_track_that_was_stopped() {
        let mut engine = engine_with(3);
        engine.handle(Command::Next);
        engine.handle(Command::Stop);
        assert_eq!(engine.state().status, PlaybackStatus::Stopped);

        engine.handle(Command::Toggle);
        assert_eq!(engine.state().status, PlaybackStatus::Playing);
        assert_eq!(engine.state().track_id, Some(2));
    }

    #[test]
    fn pause_and_resume_are_idempotent() {
        let mut engine = engine_with(1);
        assert_eq!(engine.handle(Command::Resume), Vec::new());
        assert_eq!(engine.handle(Command::Pause), vec![Event::StateChanged]);
        assert_eq!(engine.handle(Command::Pause), Vec::new());
    }

    #[test]
    fn stop_reports_position_zero() {
        let mut engine = engine_with(1);
        engine.handle(Command::Seek {
            position_ms: 30_000,
        });
        engine.handle(Command::Stop);
        assert_eq!(engine.state().position_ms, 0);
    }

    #[test]
    fn next_past_the_end_stops() {
        let mut engine = engine_with(2);
        engine.handle(Command::Next);
        assert_eq!(engine.state().track_id, Some(2));

        engine.handle(Command::Next);
        assert_eq!(engine.state().status, PlaybackStatus::Stopped);
    }

    #[test]
    fn previous_restarts_the_track_once_past_the_grace_period() {
        let mut engine = engine_with(3);
        engine.handle(Command::Next);
        engine.handle(Command::Seek { position_ms: 5_000 });

        engine.handle(Command::Previous);
        assert_eq!(engine.state().track_id, Some(2));
        assert_eq!(engine.state().position_ms, 0);
    }

    #[test]
    fn previous_steps_back_within_the_grace_period() {
        let mut engine = engine_with(3);
        engine.handle(Command::Next);
        engine.handle(Command::Seek { position_ms: 1_000 });

        engine.handle(Command::Previous);
        assert_eq!(engine.state().track_id, Some(1));
    }

    #[test]
    fn previous_from_the_first_track_stops() {
        let mut engine = engine_with(2);
        engine.handle(Command::Previous);
        assert_eq!(engine.state().status, PlaybackStatus::Stopped);
    }

    #[test]
    fn seek_clamps_to_the_track_length() {
        let mut engine = Engine::new(FakeSink::default(), 1.0, false);
        engine.handle(Command::SetQueue {
            entries: vec![entry(1, 10_000)],
            index: 0,
        });

        engine.handle(Command::Seek {
            position_ms: 99_000,
        });
        assert_eq!(engine.state().position_ms, 10_000);

        engine.handle(Command::Seek {
            position_ms: -5_000,
        });
        assert_eq!(engine.state().position_ms, 0);
    }

    #[test]
    fn seek_while_stopped_does_nothing() {
        let mut engine = Engine::new(FakeSink::default(), 1.0, false);
        assert_eq!(
            engine.handle(Command::Seek { position_ms: 100 }),
            Vec::new()
        );
    }

    #[test]
    fn volume_is_clamped_and_reaches_the_sink() {
        let mut engine = Engine::new(FakeSink::default(), 0.5, false);

        engine.handle(Command::SetVolume(4.2));
        assert_eq!(engine.state().volume, 1.0);

        engine.handle(Command::SetVolume(-1.0));
        assert_eq!(engine.state().volume, 0.0);

        engine.handle(Command::SetVolume(f32::NAN));
        assert_eq!(engine.state().volume, 0.0);
    }

    #[test]
    fn volume_survives_loading_the_next_track() {
        let mut engine = engine_with(2);
        engine.handle(Command::SetVolume(0.25));
        engine.handle(Command::Next);
        assert_eq!(engine.state().volume, 0.25);
    }

    #[test]
    fn muting_silences_the_sink_without_forgetting_the_level() {
        let mut engine = engine_with(1);
        engine.handle(Command::SetVolume(0.4));

        engine.handle(Command::SetMuted(true));
        assert_eq!(engine.sink.volume, 0.0, "the sink hears silence");
        assert_eq!(engine.state().volume, 0.4, "the rail still says 40%");
        assert!(engine.state().muted);

        engine.handle(Command::SetMuted(false));
        assert_eq!(engine.sink.volume, 0.4, "and 40% is what comes back");
        assert!(!engine.state().muted);
    }

    #[test]
    fn a_volume_of_zero_is_not_the_same_state_as_muted() {
        // Turning it down and shutting it up are different intentions, and
        // unmuting has to be able to tell them apart.
        let mut engine = engine_with(1);
        engine.handle(Command::SetVolume(0.0));
        assert!(!engine.state().muted);

        engine.handle(Command::SetMuted(true));
        engine.handle(Command::SetMuted(false));
        assert_eq!(engine.state().volume, 0.0, "silence, restored as silence");
    }

    #[test]
    fn moving_the_rail_lifts_a_mute() {
        let mut engine = engine_with(1);
        engine.handle(Command::SetMuted(true));

        engine.handle(Command::SetVolume(0.6));

        assert!(!engine.state().muted);
        assert_eq!(engine.sink.volume, 0.6);
    }

    #[test]
    fn a_mute_survives_the_next_track() {
        let mut engine = engine_with(2);
        engine.handle(Command::SetMuted(true));
        engine.handle(Command::Next);
        assert!(engine.state().muted);
        assert_eq!(engine.sink.volume, 0.0);
    }

    #[test]
    fn muting_twice_reports_nothing_the_second_time() {
        let mut engine = engine_with(1);
        assert_eq!(
            engine.handle(Command::SetMuted(true)),
            vec![Event::StateChanged]
        );
        assert_eq!(engine.handle(Command::SetMuted(true)), Vec::new());
        assert_eq!(
            engine.handle(Command::SetRepeatOne(true)),
            vec![Event::StateChanged]
        );
        assert_eq!(engine.handle(Command::SetRepeatOne(true)), Vec::new());
    }

    #[test]
    fn an_engine_started_muted_is_silent_before_anything_plays() {
        let engine = Engine::new(FakeSink::default(), 0.7, true);
        assert_eq!(engine.sink.volume, 0.0);
        assert_eq!(engine.state().volume, 0.7);
        assert!(engine.state().muted);
    }

    #[test]
    fn repeat_plays_the_same_track_again_instead_of_advancing() {
        let mut engine = engine_with(3);
        engine.handle(Command::SetRepeatOne(true));
        engine.sink.exhausted = true;

        engine.tick();

        assert_eq!(engine.state().track_id, Some(1));
        assert_eq!(engine.state().status, PlaybackStatus::Playing);
        assert_eq!(engine.state().position_ms, 0);
    }

    #[test]
    fn the_last_track_on_repeat_does_not_stop() {
        // Without repeat this is where playback ends; with it, the queue having
        // run out is not a reason to stop.
        let mut engine = engine_with(1);
        engine.handle(Command::SetRepeatOne(true));
        engine.sink.exhausted = true;

        engine.tick();
        assert_eq!(engine.state().status, PlaybackStatus::Playing);
    }

    #[test]
    fn every_loop_counts_as_a_play() {
        // The point of the phase: an hour of one song on repeat is an hour of
        // plays, not one. Most Played is the feature that would be wrong.
        let mut engine = Engine::new(FakeSink::default(), 1.0, false);
        engine.handle(Command::SetQueue {
            entries: vec![entry(7, 10_000)],
            index: 0,
        });
        engine.handle(Command::SetRepeatOne(true));

        for loops in 1..=3 {
            engine.handle(Command::Seek { position_ms: 9_000 });
            assert!(
                engine.tick().contains(&Event::Played(7)),
                "loop {loops} went uncounted"
            );
            // Which is what the end of a track looks like to the engine.
            engine.sink.exhausted = true;
            engine.tick();
        }
    }

    #[test]
    fn next_ignores_repeat() {
        // Repeat is what the *end of a track* means, not what the button does:
        // asking for the next song and reaching the end of this one are
        // different requests.
        let mut engine = engine_with(3);
        engine.handle(Command::SetRepeatOne(true));

        engine.handle(Command::Next);
        assert_eq!(engine.state().track_id, Some(2));
    }

    #[test]
    fn a_play_is_counted_once_at_the_halfway_mark() {
        let mut engine = Engine::new(FakeSink::default(), 1.0, false);
        engine.handle(Command::SetQueue {
            entries: vec![entry(7, 10_000)],
            index: 0,
        });

        engine.handle(Command::Seek { position_ms: 4_999 });
        assert!(!engine.tick().contains(&Event::Played(7)));

        engine.handle(Command::Seek { position_ms: 5_000 });
        assert!(engine.tick().contains(&Event::Played(7)));

        // Still past the threshold, but already counted.
        engine.handle(Command::Seek { position_ms: 6_000 });
        assert!(!engine.tick().contains(&Event::Played(7)));
    }

    #[test]
    fn a_track_of_unknown_length_is_never_counted() {
        let mut engine = Engine::new(FakeSink::default(), 1.0, false);
        engine.handle(Command::SetQueue {
            entries: vec![entry(7, 0)],
            index: 0,
        });
        engine.handle(Command::Seek { position_ms: 0 });
        assert!(!engine
            .tick()
            .iter()
            .any(|event| matches!(event, Event::Played(_))));
    }

    #[test]
    fn replaying_a_track_counts_it_again() {
        let mut engine = Engine::new(FakeSink::default(), 1.0, false);
        let entries = vec![entry(7, 10_000)];
        engine.handle(Command::SetQueue {
            entries: entries.clone(),
            index: 0,
        });
        engine.handle(Command::Seek { position_ms: 9_000 });
        assert!(engine.tick().contains(&Event::Played(7)));

        engine.handle(Command::SetQueue { entries, index: 0 });
        engine.handle(Command::Seek { position_ms: 9_000 });
        assert!(engine.tick().contains(&Event::Played(7)));
    }

    #[test]
    fn a_finished_track_advances_the_queue_on_the_next_tick() {
        let mut engine = engine_with(2);
        engine.sink.exhausted = true;

        let events = engine.tick();
        assert!(events.contains(&Event::StateChanged));
        assert_eq!(engine.state().track_id, Some(2));
        assert_eq!(engine.state().status, PlaybackStatus::Playing);
    }

    #[test]
    fn the_last_track_finishing_stops_playback() {
        let mut engine = engine_with(1);
        engine.sink.exhausted = true;

        engine.tick();
        assert_eq!(engine.state().status, PlaybackStatus::Stopped);
    }

    #[test]
    fn ticking_while_paused_emits_nothing() {
        let mut engine = engine_with(1);
        engine.handle(Command::Pause);
        assert_eq!(engine.tick(), Vec::new());
    }

    #[test]
    fn position_is_reported_only_when_it_moves() {
        let mut engine = engine_with(1);
        engine.sink.position = Duration::from_millis(1_500);

        assert_eq!(
            engine.tick(),
            vec![Event::Position {
                position_ms: 1_500,
                duration_ms: 200_000,
            }]
        );
        assert_eq!(engine.tick(), Vec::new());
    }

    #[test]
    fn an_unreadable_file_is_reported_and_the_engine_moves_on() {
        let mut engine = Engine::new(FakeSink::default(), 1.0, false);
        engine.sink.fail_load = true;

        let events = engine.handle(Command::SetQueue {
            entries: vec![entry(1, 1000), entry(2, 1000)],
            index: 0,
        });

        assert!(events.iter().any(|e| matches!(e, Event::Error(_))));
        assert_eq!(engine.state().status, PlaybackStatus::Stopped);
    }

    #[test]
    fn a_run_of_unreadable_files_gives_up_rather_than_walking_the_library() {
        let mut engine = Engine::new(FakeSink::default(), 1.0, false);
        engine.sink.fail_load = true;

        engine.handle(Command::SetQueue {
            entries: (1..=1000).map(|id| entry(id, 1000)).collect(),
            index: 0,
        });

        assert_eq!(engine.sink.loads.len(), MAX_CONSECUTIVE_LOAD_FAILURES);
        assert_eq!(engine.state().status, PlaybackStatus::Stopped);
    }

    #[test]
    fn a_file_that_will_not_open_is_named_so_it_can_be_marked_missing() {
        let mut engine = Engine::new(FakeSink::default(), 1.0, false);
        engine.sink.fail_load = true;

        let events = engine.handle(Command::SetQueue {
            entries: vec![entry(7, 1000), entry(8, 1000)],
            index: 0,
        });

        // The error message is for the user; the id is what lets the library
        // mark the row, which is why both are emitted rather than one string.
        let failed: Vec<_> = events
            .iter()
            .filter_map(|e| match e {
                Event::LoadFailed(id) => Some(*id),
                _ => None,
            })
            .collect();
        assert_eq!(failed, [7, 8], "each file it tried, in the order it tried");
    }
}
