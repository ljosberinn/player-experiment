//! The audio output seam.
//!
//! [`AudioSink`] is the boundary between the playback state machine and real
//! hardware. The state machine is where the interesting behaviour lives
//! (queue advance, seek clamping, when a play counts), and CI has no sound
//! card, so that behaviour is tested against a fake implementation of this
//! trait instead of against `rodio`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::Duration;

use rodio::cpal;
use rodio::cpal::traits::{DeviceTrait, HostTrait};

/// Somewhere decoded audio can be sent.
///
/// Implementations are driven from a single thread; nothing here needs to be
/// `Sync`.
pub trait AudioSink: Send {
    /// Loads `path`, replacing whatever was loaded before, and leaves it
    /// paused at position zero.
    fn load(&mut self, path: &Path) -> Result<(), String>;
    /// Hints that `path` is about to be loaded, so the cost of opening it can
    /// be paid before the engine is waiting on it.
    ///
    /// Advisory in both directions: an implementation may ignore it, and a
    /// `load` of some other path is always correct. Never blocks.
    fn prepare(&mut self, _path: &Path) {}
    fn play(&mut self);
    fn pause(&mut self);
    /// Unloads the current source. `position` reads zero afterwards.
    fn stop(&mut self);
    fn set_volume(&mut self, volume: f32);
    fn seek(&mut self, position: Duration) -> Result<(), String>;
    fn position(&self) -> Duration;
    /// Whether the loaded source has run out. `true` when nothing is loaded.
    fn finished(&self) -> bool;
    /// Re-establishes output on the current default device.
    ///
    /// `Ok(true)` when the output actually changed and the caller must reload -
    /// whatever was loaded is bound to the old output and does not survive.
    /// The sink never learns which path that was; putting the reload back is
    /// the engine's job, which is also the only way it gets tested.
    fn reopen_output(&mut self) -> Result<bool, String> {
        Ok(false)
    }
}

/// The id of the current default output device, or `None` when there is none.
///
/// [`DeviceTrait::id`] rather than the deprecated `name`: WASAPI implements it
/// as `IMMDevice::GetId`, which is stable across reboots and reconnections.
pub fn default_output_id() -> Option<cpal::DeviceId> {
    cpal::default_host().default_output_device()?.id().ok()
}

/// [`AudioSink`] backed by `rodio` (cpal output, symphonia decode).
pub struct RodioSink {
    /// Owns the cpal stream: dropping it silences everything, so it is held
    /// for as long as the player thread lives even though nothing reads it.
    device: rodio::stream::MixerDeviceSink,
    /// Which device [`Self::device`] was opened on, for
    /// [`AudioSink::reopen_output`] to compare the default against.
    ///
    /// `None` when cpal would not tell us, which reads as "not the default"
    /// and so costs a reopen we did not need rather than missing one we did.
    device_id: Option<cpal::DeviceId>,
    /// Raised by the cpal error callback when the stream dies - an endpoint
    /// that was unplugged, disabled, or had its session moved.
    ///
    /// Shared with the output watcher, which is what turns it into a
    /// [`Command::OutputChanged`](super::Command::OutputChanged): the callback
    /// runs on a cpal thread and does nothing but set this.
    faulted: Arc<AtomicBool>,
    /// Whether [`Self::device`] is known to be a stream nothing pulls.
    ///
    /// [`Self::faulted`] is a one-shot signal and the verdict it produces
    /// outlives it: a reopen that found no device to move to leaves this set,
    /// and the flag it was read from cleared. Without the distinction a device
    /// unplugged and plugged back in would come back under the same
    /// `DeviceId` - stable across reconnections is the point of it - and the
    /// id comparison in [`AudioSink::reopen_output`] would decide there was
    /// nothing to do, over a stream that is still dead.
    dead: bool,
    /// One `rodio::Player` per loaded track rather than one for the whole
    /// session. `Player`'s queue semantics (`clear` blocks until the mixer
    /// drains) are more than we need, and dropping it stops the sound, so a
    /// fresh one per track is both simpler and cheap.
    player: Option<rodio::Player>,
    volume: f32,
    /// A decoder being built ahead of time by [`AudioSink::prepare`], with the
    /// path it was asked for. Only ever consumed by a `load` of that same
    /// path, so a skip or a queue edit needs no invalidation of its own.
    pending: Option<Pending>,
}

/// What `rodio::Decoder::try_from` hands back for a file.
type PreparedDecoder = rodio::Decoder<std::io::BufReader<std::fs::File>>;

struct Pending {
    path: PathBuf,
    decoder: Receiver<Result<PreparedDecoder, String>>,
}

impl RodioSink {
    /// Opens the default output device.
    ///
    /// Fails when there is no device at all (a headless CI runner, say); the
    /// caller keeps the app running without audio rather than refusing to
    /// start.
    pub fn open() -> Result<Self, String> {
        let faulted = Arc::new(AtomicBool::new(false));
        let (device, device_id) = open_default(&faulted)?;
        Ok(Self {
            device,
            device_id,
            faulted,
            dead: false,
            player: None,
            volume: 1.0,
            pending: None,
        })
    }

    /// The flag the stream's error callback raises, for the output watcher.
    pub fn faulted(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.faulted)
    }

    /// Whether the open stream has died, consuming the callback's flag.
    fn dead(&mut self) -> bool {
        self.dead |= self.faulted.swap(false, Ordering::AcqRel);
        self.dead
    }
}

/// Whether output has to be re-established, given what is open and what the
/// OS now calls default.
///
/// Split out because it is the whole of the decision and the only part of it
/// that can be tested without a sound card.
fn needs_reopen(
    dead: bool,
    open: Option<&cpal::DeviceId>,
    default: Option<&cpal::DeviceId>,
) -> bool {
    // A device with no id reads as "not the default", so an unknown costs a
    // reopen that was not needed rather than missing one that was.
    dead || open.is_none() || open != default
}

/// Opens a stream on the default output device, raising `faulted` if it dies.
///
/// Acquires the [`cpal::Device`] itself rather than calling
/// `DeviceSinkBuilder::open_default_sink`, which reports neither the device it
/// settled on nor a way to hear about stream errors - and both are what
/// following the OS default is built out of. `open_sink_or_fallback` keeps
/// rodio's fallback across *configurations* of the chosen device; its wider
/// fallback across every other device is given up with it.
fn open_default(
    faulted: &Arc<AtomicBool>,
) -> Result<(rodio::stream::MixerDeviceSink, Option<cpal::DeviceId>), String> {
    let device = cpal::default_host()
        .default_output_device()
        .ok_or_else(|| "no audio output device".to_owned())?;
    let device_id = device.id().ok();
    let raise = Arc::clone(faulted);
    let mut sink = rodio::stream::DeviceSinkBuilder::from_device(device)
        // A device that is there but will not describe itself, which is not
        // the same as no device and should not read like it.
        .map_err(|e| format!("the audio output device would not open: {e}"))?
        // Runs on a cpal thread, so it must not block: it raises the flag and
        // returns, and the watcher's next poll turns that into a reopen.
        .with_error_callback(move |_| raise.store(true, Ordering::Release))
        .open_sink_or_fallback()
        .map_err(|e| format!("the audio output device would not open: {e}"))?;
    // Drops are no longer a shutdown-only event, so the one-line notice rodio
    // prints on each of them would now appear mid-session.
    sink.log_on_drop(false);
    Ok((sink, device_id))
}

/// Opens `path` and builds a decoder for it. All of the first-read I/O a load
/// costs is here, which is why it is also what `prepare` runs off-thread.
fn decode(path: &Path) -> Result<PreparedDecoder, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    rodio::Decoder::try_from(file).map_err(|e| format!("{}: cannot decode: {e}", path.display()))
}

impl RodioSink {
    /// The prepared decoder for `path`, if that is what was prepared.
    ///
    /// Waits for the scratch thread rather than giving up on it: by the time a
    /// load arrives the work is seconds old, and waiting on it is at worst the
    /// same read this would otherwise do itself. A prefetch that failed is
    /// discarded so the error the caller sees comes from a fresh attempt.
    fn take_prepared(&mut self, path: &Path) -> Option<PreparedDecoder> {
        if !self.pending.as_ref().is_some_and(|p| p.path == path) {
            return None;
        }
        self.pending.take()?.decoder.recv().ok()?.ok()
    }
}

impl AudioSink for RodioSink {
    fn prepare(&mut self, path: &Path) {
        if self.pending.as_ref().is_some_and(|p| p.path == path) {
            return;
        }
        let (tx, rx) = std::sync::mpsc::channel();
        let owned = path.to_path_buf();
        // Detached: nothing joins it, and a send into a dropped receiver is
        // how it learns the prefetch was abandoned.
        std::thread::Builder::new()
            .name("prefetch".to_owned())
            .spawn(move || {
                let _ = tx.send(decode(&owned));
            })
            .ok();
        self.pending = Some(Pending {
            path: path.to_path_buf(),
            decoder: rx,
        });
    }

    fn load(&mut self, path: &Path) -> Result<(), String> {
        // A load is the free moment to recover a dead stream - nothing is
        // playing to interrupt - and it is reachable before the watcher's next
        // poll is. Skipping it would connect this track to a mixer nothing
        // pulls: silence, and a track that never reports itself finished.
        if self.dead() {
            self.reopen_output()?;
        }

        let decoder = match self.take_prepared(path) {
            Some(decoder) => decoder,
            None => decode(path)?,
        };

        let player = rodio::Player::connect_new(self.device.mixer());
        player.pause();
        player.set_volume(self.volume);
        player.append(decoder);
        self.player = Some(player);
        Ok(())
    }

    fn play(&mut self) {
        if let Some(player) = &self.player {
            player.play();
        }
    }

    fn pause(&mut self) {
        if let Some(player) = &self.player {
            player.pause();
        }
    }

    fn stop(&mut self) {
        // Drop, not `Player::stop`: `Drop` stops the sound and releases the
        // mixer slot in one step.
        self.player = None;
        // Nothing is going to ask for it, and it is holding a file open.
        self.pending = None;
    }

    fn set_volume(&mut self, volume: f32) {
        self.volume = volume;
        if let Some(player) = &self.player {
            player.set_volume(volume);
        }
    }

    fn seek(&mut self, position: Duration) -> Result<(), String> {
        // Refused rather than attempted on a dead stream: `try_seek` waits on
        // a reply from the mixer's periodic-access closure, which a dead
        // stream never pulls again, and the pending order holds the sender -
        // so the wait has nothing to time it out. A scrubber drag in the
        // moment before the reopen lands would hang the player thread.
        if self.dead() {
            return Err("the audio output device went away".to_owned());
        }
        match &self.player {
            Some(player) => player.try_seek(position).map_err(|e| e.to_string()),
            None => Err("nothing is loaded".to_owned()),
        }
    }

    fn position(&self) -> Duration {
        self.player
            .as_ref()
            .map_or(Duration::ZERO, rodio::Player::get_pos)
    }

    fn finished(&self) -> bool {
        self.player.as_ref().is_none_or(rodio::Player::empty)
    }

    fn reopen_output(&mut self) -> Result<bool, String> {
        let dead = self.dead();
        if !needs_reopen(dead, self.device_id.as_ref(), default_output_id().as_ref()) {
            return Ok(false);
        }

        // On failure `dead` stays set, so the next change in the default -
        // typically the device being plugged back in - tries again. The
        // watcher is not asked to retry on a timer: it fires on transitions,
        // and there is nothing to move to until one happens.
        let (device, device_id) = open_default(&self.faulted)?;
        // Before the old sink goes: the player is connected to its mixer, and
        // the decoder inside it cannot be moved to another one.
        self.player = None;
        self.device = device;
        self.device_id = device_id;
        self.dead = false;
        Ok(true)
    }
}

/// The sink used when no output device could be opened.
///
/// Every load fails with the reason the device could not be opened, so the
/// user gets that message the first time they press play instead of an app
/// that silently does nothing - or one that refused to start at all.
pub struct NullSink {
    reason: String,
}

impl NullSink {
    pub fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
        }
    }
}

impl AudioSink for NullSink {
    fn load(&mut self, _path: &Path) -> Result<(), String> {
        Err(self.reason.clone())
    }
    fn play(&mut self) {}
    fn pause(&mut self) {}
    fn stop(&mut self) {}
    fn set_volume(&mut self, _volume: f32) {}
    fn seek(&mut self, _position: Duration) -> Result<(), String> {
        Err(self.reason.clone())
    }
    fn position(&self) -> Duration {
        Duration::ZERO
    }
    fn finished(&self) -> bool {
        true
    }
}

/// A sink that accepts every load and plays silence on a wall clock.
///
/// The counterpart to [`NullSink`], for the one machine where "no audio
/// device" is the normal case rather than a fault: a CI runner. There, a real
/// build falls back to `NullSink`, every load fails, and so nothing downstream
/// of a successful load can be tested end to end - not the playing marker on a
/// row, not the status display, not the position events. This sink makes those
/// reachable without a sound card, and the e2e build is the only build that
/// can select it (see `lib.rs`).
///
/// It never reports itself finished while something is loaded. A track that
/// ends would advance the queue mid-assertion, and what the tests using this
/// need is a track that stays put; queue advance has its own deterministic
/// coverage against `FakeSink`.
#[cfg(any(test, feature = "wdio"))]
#[derive(Debug, Default)]
pub struct SilentSink {
    loaded: bool,
    /// When the current run of playback started; `None` while paused.
    since: Option<std::time::Instant>,
    /// Everything played before the current run.
    before: Duration,
}

#[cfg(any(test, feature = "wdio"))]
impl SilentSink {
    pub fn new() -> Self {
        Self::default()
    }
}

#[cfg(any(test, feature = "wdio"))]
impl AudioSink for SilentSink {
    fn load(&mut self, _path: &Path) -> Result<(), String> {
        self.loaded = true;
        self.since = None;
        self.before = Duration::ZERO;
        Ok(())
    }

    fn play(&mut self) {
        if self.loaded && self.since.is_none() {
            self.since = Some(std::time::Instant::now());
        }
    }

    fn pause(&mut self) {
        if let Some(started) = self.since.take() {
            self.before += started.elapsed();
        }
    }

    fn stop(&mut self) {
        self.loaded = false;
        self.since = None;
        self.before = Duration::ZERO;
    }

    fn set_volume(&mut self, _volume: f32) {}

    fn seek(&mut self, position: Duration) -> Result<(), String> {
        if !self.loaded {
            return Err("nothing is loaded".to_owned());
        }
        self.before = position;
        // Restarted so the elapsed time since the seek counts from there.
        self.since = self.since.map(|_| std::time::Instant::now());
        Ok(())
    }

    fn position(&self) -> Duration {
        self.before
            + self
                .since
                .map_or(Duration::ZERO, |started| started.elapsed())
    }

    fn finished(&self) -> bool {
        !self.loaded
    }
}

/// An [`AudioSink`] that decodes nothing, for tests.
///
/// Position advances only when a test advances it, so queue-advance and
/// play-count behaviour can be driven deterministically instead of waited on.
#[cfg(test)]
#[derive(Debug, Default)]
pub struct FakeSink {
    pub loaded: Option<std::path::PathBuf>,
    pub playing: bool,
    pub volume: f32,
    pub position: Duration,
    /// Set to make the next `load` fail, standing in for an unreadable file.
    pub fail_load: bool,
    /// Reported by `finished`; tests flip it to end a track.
    pub exhausted: bool,
    /// Every path `load` was called with, successful or not.
    pub loads: Vec<std::path::PathBuf>,
    /// Every path `prepare` was called with.
    pub prepares: Vec<std::path::PathBuf>,
    /// What the next `reopen_output` returns. `None` is the trait default.
    pub reopen: Option<Result<bool, String>>,
    /// How many times `reopen_output` was called.
    pub reopens: usize,
}

#[cfg(test)]
impl AudioSink for FakeSink {
    fn prepare(&mut self, path: &Path) {
        self.prepares.push(path.to_path_buf());
    }

    fn load(&mut self, path: &Path) -> Result<(), String> {
        self.loads.push(path.to_path_buf());
        if self.fail_load {
            return Err(format!("{}: cannot decode", path.display()));
        }
        self.loaded = Some(path.to_path_buf());
        self.playing = false;
        self.position = Duration::ZERO;
        self.exhausted = false;
        Ok(())
    }

    fn play(&mut self) {
        self.playing = true;
    }

    fn pause(&mut self) {
        self.playing = false;
    }

    fn stop(&mut self) {
        self.loaded = None;
        self.playing = false;
        self.position = Duration::ZERO;
        self.exhausted = false;
    }

    fn set_volume(&mut self, volume: f32) {
        self.volume = volume;
    }

    fn seek(&mut self, position: Duration) -> Result<(), String> {
        if self.loaded.is_none() {
            return Err("nothing is loaded".to_owned());
        }
        self.position = position;
        Ok(())
    }

    fn position(&self) -> Duration {
        self.position
    }

    fn finished(&self) -> bool {
        self.loaded.is_none() || self.exhausted
    }

    fn reopen_output(&mut self) -> Result<bool, String> {
        self.reopens += 1;
        match self.reopen.take() {
            // A real reopen takes the loaded source with it, so a caller that
            // forgets to reload is left with nothing loaded here too.
            Some(Ok(true)) => {
                self.loaded = None;
                self.playing = false;
                self.position = Duration::ZERO;
                Ok(true)
            }
            Some(outcome) => outcome,
            None => Ok(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device_id(name: &str) -> cpal::DeviceId {
        cpal::DeviceId(cpal::default_host().id(), name.to_owned())
    }

    #[test]
    fn output_is_reopened_only_when_it_has_to_be() {
        let open = device_id("speakers");
        let other = device_id("headphones");

        // The duplicate command the watcher's coalescing leans on: the poll
        // fires on a transition, and more than one can name the same device.
        assert!(!needs_reopen(false, Some(&open), Some(&open)));
        assert!(needs_reopen(false, Some(&open), Some(&other)));

        // Unplugged and plugged back in. `DeviceId` is stable across a
        // reconnection, so the ids agree and only the dead stream says
        // otherwise.
        assert!(needs_reopen(true, Some(&open), Some(&open)));

        // Nothing to move to yet, and nothing that could be made worse by
        // trying: a failed reopen leaves `dead` set for the next transition.
        assert!(needs_reopen(true, Some(&open), None));
    }

    #[test]
    fn the_silent_sink_advances_only_while_it_is_playing() {
        let mut sink = SilentSink::new();
        sink.load(Path::new(r"C:\music\1.mp3")).unwrap();
        assert_eq!(sink.position(), Duration::ZERO);

        sink.play();
        std::thread::sleep(Duration::from_millis(30));
        sink.pause();
        let paused_at = sink.position();
        assert!(paused_at > Duration::ZERO, "position never moved");

        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(
            sink.position(),
            paused_at,
            "a paused sink kept counting wall-clock time"
        );
    }

    #[test]
    fn the_silent_sink_seeks_and_stops() {
        let mut sink = SilentSink::new();
        assert!(
            sink.seek(Duration::from_secs(1)).is_err(),
            "seeking nothing must fail, not silently succeed"
        );

        sink.load(Path::new(r"C:\music\1.mp3")).unwrap();
        sink.seek(Duration::from_secs(30)).unwrap();
        assert!(sink.position() >= Duration::from_secs(30));

        // Never finished while loaded: a track that ended would advance the
        // queue underneath whatever is asserting on it.
        sink.play();
        assert!(!sink.finished());

        sink.stop();
        assert!(sink.finished());
        assert_eq!(sink.position(), Duration::ZERO);
    }
}
