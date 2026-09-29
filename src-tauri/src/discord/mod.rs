//! Discord's "Listening to" card, for whatever is playing.
//!
//! One thread, fed the player's state on every `StateChanged`, keeps the
//! latest activity it wants shown and sends it at most once per [`THROTTLE`].
//! Discord is optional software: a missing or broken pipe is logged and
//! retried, never reported to the window.

pub mod transport;

use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use rusqlite::{Connection, OptionalExtension};

use crate::audio::EngineState;
use crate::db::{settings, Db};
use crate::error::AppResult;
use crate::log::{Fields, Log};
use crate::model::PlaybackStatus;
use transport::{Transport, TransportError};

/// The "Apex" application in Discord's Developer Portal. Public: it names the
/// application, and Discord's IPC needs no secret.
pub const CLIENT_ID: &str = "1554533728355754054";

/// The app logo, uploaded under the application's Rich Presence art assets.
const LOGO: &str = "apex";

/// Discord allows five activity updates per twenty seconds.
const THROTTLE: Duration = Duration::from_secs(4);

/// How often a pipe that failed is tried again while something is playing.
const RETRY: Duration = Duration::from_secs(30);

/// How far apart two reports of one track's start may be and still be the
/// same: a volume change reports a playhead that has moved by however long the
/// report took.
const SAME_START_MS: i64 = 1_000;

/// Discord's bounds on `details`, `state` and `large_text`, in UTF-16 units.
const MIN_TEXT: usize = 2;
const MAX_TEXT: usize = 128;

/// The track playing, as wall-clock times so a late send is not a wrong one.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Playing {
    pub track_id: i64,
    pub start_ms: i64,
    pub end_ms: i64,
}

impl Playing {
    /// `None` while paused or stopped, which is when the card is cleared.
    pub fn from_state(state: &EngineState, now_ms: i64) -> Option<Self> {
        if state.status != PlaybackStatus::Playing {
            return None;
        }
        let start_ms = now_ms - state.position_ms;
        Some(Self {
            track_id: state.track_id?,
            start_ms,
            end_ms: start_ms + state.duration_ms,
        })
    }

    fn same(this: Option<Self>, other: Option<Self>) -> bool {
        match (this, other) {
            (None, None) => true,
            (Some(a), Some(b)) => {
                a.track_id == b.track_id && (a.start_ms - b.start_ms).abs() <= SAME_START_MS
            }
            _ => false,
        }
    }
}

/// What the card shows.
#[derive(Debug, Clone, PartialEq)]
pub struct Activity {
    pub details: String,
    /// The artist. Absent, the card reads "Listening to Apex".
    pub state: Option<String>,
    pub large_image: String,
    pub large_text: Option<String>,
    pub start_ms: i64,
    pub end_ms: i64,
}

/// The activity for `playing`, or `None` for a track that is no longer there.
fn activity(conn: &Connection, playing: Playing) -> AppResult<Option<Activity>> {
    let row = conn
        .query_row(
            "SELECT path, title, artist, album, release_mbid, release_group_mbid
             FROM tracks WHERE id = ?1",
            [playing.track_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()?;
    let Some((path, title, artist, album, release_mbid, release_group_mbid)) = row else {
        return Ok(None);
    };

    // The row's fallback: a track with no title is listed by its file name.
    let title = present(title).unwrap_or_else(|| {
        Path::new(&path)
            .file_name()
            .map_or_else(|| path.clone(), |name| name.to_string_lossy().into_owned())
    });
    Ok(Some(Activity {
        details: fit(&title),
        state: present(artist).map(|artist| fit(&artist)),
        large_image: cover(release_group_mbid, release_mbid),
        large_text: present(album).map(|album| fit(&album)),
        start_ms: playing.start_ms,
        end_ms: playing.end_ms,
    }))
}

/// The group before the release: many pressings have no art of their own, and
/// the archive answers a group with the front it chose from any of them.
/// Nothing here can tell whether a release has art without asking the archive.
fn cover(release_group_mbid: Option<String>, release_mbid: Option<String>) -> String {
    if let Some(mbid) = present(release_group_mbid) {
        return format!("https://coverartarchive.org/release-group/{mbid}/front-500");
    }
    if let Some(mbid) = present(release_mbid) {
        return format!("https://coverartarchive.org/release/{mbid}/front-500");
    }
    LOGO.to_owned()
}

fn present(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
}

/// Clamps `text` into Discord's bounds, which it counts in UTF-16 units.
fn fit(text: &str) -> String {
    let text = text.trim();
    let units = text.encode_utf16().count();
    if units > MAX_TEXT {
        let mut fitted = String::new();
        let mut used = 1; // the ellipsis
        for c in text.chars() {
            used += c.len_utf16();
            if used > MAX_TEXT {
                break;
            }
            fitted.push(c);
        }
        fitted.push('…');
        return fitted;
    }
    // Zero-width rather than a space, which Discord trims before counting.
    let mut fitted = text.to_owned();
    for _ in units..MIN_TEXT {
        fitted.push('\u{200B}');
    }
    fitted
}

/// Where the pipe stands, for logging each change once.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Link {
    /// Never opened, or closed because the setting went off.
    Idle,
    Up,
    Down,
}

/// The rules, clocked from outside so the tests need no thread and no waits.
pub struct Service {
    db: Db,
    transport: Box<dyn Transport>,
    log: Log,
    link: Link,
    /// What the player last reported.
    latest: Option<Playing>,
    /// What Discord was last given. `None` also while no pipe is open:
    /// Discord drops the activity with the pipe.
    shown: Option<Playing>,
    /// When the first change not yet sent arrived.
    pending_since: Option<Instant>,
    retry_at: Option<Instant>,
    /// The setting changed: a click in Settings is answered at once.
    urgent: bool,
}

impl Service {
    pub fn new(db: Db, transport: Box<dyn Transport>, log: Log) -> Self {
        Self {
            db,
            transport,
            log,
            link: Link::Idle,
            latest: None,
            shown: None,
            pending_since: None,
            retry_at: None,
            urgent: false,
        }
    }

    pub fn playing(&mut self, playing: Option<Playing>, now: Instant) {
        self.latest = playing;
        self.pending_since.get_or_insert(now);
    }

    pub fn setting_changed(&mut self) {
        self.urgent = true;
    }

    /// Does whatever is due at `now`, and says when to call again.
    pub fn tick(&mut self, now: Instant) -> Option<Instant> {
        let enabled = self
            .db
            .conn()
            .and_then(|conn| settings::discord_presence(&conn))
            .unwrap_or(false);

        if !enabled {
            self.urgent = false;
            self.pending_since = None;
            self.retry_at = None;
            if self.link == Link::Up && self.shown.is_some() {
                let _ = self.transport.clear();
            }
            if self.link != Link::Idle {
                self.transport.close();
                self.relink(Link::Idle, None);
            }
            self.shown = None;
            return None;
        }

        let wanted = self.latest;
        let settled = match wanted {
            None => self.shown.is_none(),
            Some(_) => self.link == Link::Up && Playing::same(wanted, self.shown),
        };
        if settled {
            self.urgent = false;
            self.pending_since = None;
            self.retry_at = None;
            return None;
        }

        if !self.urgent {
            let due = [self.pending_since.map(|at| at + THROTTLE), self.retry_at]
                .into_iter()
                .flatten()
                .min();
            match due {
                Some(due) if due > now => return Some(due),
                None => return None,
                Some(_) => {}
            }
        }
        self.urgent = false;
        self.pending_since = None;
        self.retry_at = None;

        match wanted {
            None => {
                if let Err(error) = self.transport.clear() {
                    self.drop_pipe(error);
                }
                self.shown = None;
                None
            }
            Some(playing) => {
                if self.link != Link::Up {
                    if let Err(error) = self.transport.connect() {
                        self.relink(Link::Down, Some(&error));
                        self.retry_at = Some(now + RETRY);
                        return self.retry_at;
                    }
                    self.relink(Link::Up, None);
                }
                self.show(playing, now)
            }
        }
    }

    fn show(&mut self, playing: Playing, now: Instant) -> Option<Instant> {
        let activity = self
            .db
            .conn()
            .and_then(|conn| activity(&conn, playing))
            .ok()
            .flatten();
        let sent = match &activity {
            Some(activity) => self.transport.set(activity),
            None => self.transport.clear(),
        };
        match sent {
            Ok(()) => self.shown = Some(playing),
            // Sending it again would be refused again.
            Err(TransportError::Refused(message)) => {
                self.log.problem(
                    "discord.refused",
                    Fields::new()
                        .add("track", playing.track_id)
                        .add("error", message),
                );
                self.shown = Some(playing);
            }
            Err(error) => {
                self.drop_pipe(error);
                self.retry_at = Some(now + RETRY);
            }
        }
        self.retry_at
    }

    fn drop_pipe(&mut self, error: TransportError) {
        self.transport.close();
        self.shown = None;
        self.relink(Link::Down, Some(&error));
    }

    fn relink(&mut self, link: Link, error: Option<&TransportError>) {
        if self.link == link {
            return;
        }
        self.link = link;
        match (link, error) {
            (Link::Down, Some(error)) => self
                .log
                .problem("discord.link", Fields::new().add("error", error)),
            (Link::Up, _) => self
                .log
                .note("discord.link", Fields::new().add("state", "up")),
            _ => self
                .log
                .note("discord.link", Fields::new().add("state", "closed")),
        }
    }
}

enum Job {
    State(Option<Playing>),
    Setting,
}

/// Handle to the presence thread, the scrobbler's shape: pipe writes block,
/// and the player thread that feeds this must not.
#[derive(Clone)]
pub struct Presence {
    jobs: Sender<Job>,
}

impl Presence {
    pub fn start(db: Db, log: Log) -> Self {
        Self::spawn(Service::new(
            db,
            Box::new(transport::IpcTransport::default()),
            log,
        ))
    }

    pub fn spawn(mut service: Service) -> Self {
        let (jobs, rx) = mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name("presence".to_owned())
            .spawn(move || {
                let mut wake: Option<Instant> = None;
                loop {
                    let job = match wake {
                        Some(at) => {
                            match rx.recv_timeout(at.saturating_duration_since(Instant::now())) {
                                Ok(job) => Some(job),
                                Err(RecvTimeoutError::Timeout) => None,
                                Err(RecvTimeoutError::Disconnected) => return,
                            }
                        }
                        None => match rx.recv() {
                            Ok(job) => Some(job),
                            Err(_) => return,
                        },
                    };
                    match job {
                        Some(Job::State(playing)) => service.playing(playing, Instant::now()),
                        Some(Job::Setting) => service.setting_changed(),
                        None => {}
                    }
                    wake = service.tick(Instant::now());
                }
            })
            .expect("spawning the presence thread");
        Self { jobs }
    }

    /// Called on the player thread with every state it reports.
    pub fn update(&self, state: &EngineState) {
        let now_ms = i64::try_from(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
        )
        .unwrap_or(i64::MAX);
        let _ = self
            .jobs
            .send(Job::State(Playing::from_state(state, now_ms)));
    }

    pub fn setting_changed(&self) {
        let _ = self.jobs.send(Job::Setting);
    }
}

#[cfg(test)]
mod tests {
    use super::transport::{Call, FakeTransport};
    use super::*;

    struct Rig {
        _dir: tempfile::TempDir,
        db: Db,
        fake: FakeTransport,
        service: Service,
        start: Instant,
    }

    impl Rig {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
            db.conn()
                .unwrap()
                .execute_batch(
                    "INSERT INTO tracks (id, path, mtime, size, duration_ms, title, artist, album, added_at)
                     VALUES (1, 'C:\\music\\1.mp3', 0, 0, 240000, 'Harbour', 'Blue Room', 'Coastline', 0),
                            (2, 'C:\\music\\2.mp3', 0, 0, 180000, 'Tide', 'Blue Room', 'Coastline', 0);",
                )
                .unwrap();
            let fake = FakeTransport::default();
            let service = Service::new(
                db.clone(),
                Box::new(fake.clone()),
                Log::to(dir.path().join("main.log")),
            );
            let rig = Self {
                _dir: dir,
                db,
                fake,
                service,
                start: Instant::now(),
            };
            rig.enable(true);
            rig
        }

        fn enable(&self, on: bool) {
            settings::set(
                &self.db.conn().unwrap(),
                settings::DISCORD_PRESENCE,
                if on { "true" } else { "false" },
            )
            .unwrap();
        }

        fn at(&self, seconds: u64) -> Instant {
            self.start + Duration::from_secs(seconds)
        }

        fn report(&mut self, playing: Option<Playing>, seconds: u64) -> Option<Instant> {
            let now = self.at(seconds);
            self.service.playing(playing, now);
            self.service.tick(now)
        }

        fn tick(&mut self, seconds: u64) -> Option<Instant> {
            self.service.tick(self.at(seconds))
        }

        fn sets(&self) -> Vec<Activity> {
            self.fake
                .calls()
                .into_iter()
                .filter_map(|call| match call {
                    Call::Set(activity) => Some(activity),
                    _ => None,
                })
                .collect()
        }
    }

    fn track(id: i64, start_ms: i64) -> Option<Playing> {
        Some(Playing {
            track_id: id,
            start_ms,
            end_ms: start_ms + 240_000,
        })
    }

    #[test]
    fn a_playing_track_becomes_the_card() {
        let mut rig = Rig::new();

        assert_eq!(rig.report(track(1, 1_000_000), 0), Some(rig.at(4)));
        assert!(
            rig.fake.calls().is_empty(),
            "nothing before the window closes"
        );
        assert_eq!(rig.tick(4), None);

        assert_eq!(
            rig.fake.calls(),
            [
                Call::Connect,
                Call::Set(Activity {
                    details: "Harbour".to_owned(),
                    state: Some("Blue Room".to_owned()),
                    large_image: LOGO.to_owned(),
                    large_text: Some("Coastline".to_owned()),
                    start_ms: 1_000_000,
                    end_ms: 1_240_000,
                })
            ]
        );
    }

    #[test]
    fn the_start_is_the_playhead_behind_the_clock() {
        let state = EngineState {
            status: PlaybackStatus::Playing,
            track_id: Some(1),
            next_track_id: None,
            queue_index: Some(0),
            queue_len: 1,
            position_ms: 30_000,
            duration_ms: 240_000,
            volume: 1.0,
            muted: false,
            repeat_one: false,
        };
        assert_eq!(
            Playing::from_state(&state, 100_000),
            Some(Playing {
                track_id: 1,
                start_ms: 70_000,
                end_ms: 310_000,
            })
        );
        let paused = EngineState {
            status: PlaybackStatus::Paused,
            ..state
        };
        assert_eq!(Playing::from_state(&paused, 100_000), None);
    }

    #[test]
    fn pause_clears_the_card() {
        let mut rig = Rig::new();
        rig.report(track(1, 0), 0);
        rig.tick(4);
        rig.fake.forget();

        rig.report(None, 10);
        rig.tick(14);

        assert_eq!(rig.fake.calls(), [Call::Clear]);
    }

    #[test]
    fn a_seek_moves_the_timestamps() {
        let mut rig = Rig::new();
        rig.report(track(1, 0), 0);
        rig.tick(4);

        rig.report(track(1, -60_000), 10);
        rig.tick(14);

        let sets = rig.sets();
        assert_eq!(sets.len(), 2);
        assert_eq!((sets[1].start_ms, sets[1].end_ms), (-60_000, 180_000));
    }

    #[test]
    fn a_report_that_changes_nothing_sends_nothing() {
        let mut rig = Rig::new();
        rig.report(track(1, 0), 0);
        rig.tick(4);
        rig.fake.forget();

        // A volume change: the same track, a playhead read a moment later.
        assert_eq!(rig.report(track(1, 12), 10), None);

        assert!(rig.fake.calls().is_empty());
    }

    #[test]
    fn a_burst_of_loads_sends_the_last_once() {
        let mut rig = Rig::new();
        rig.report(track(1, 0), 0);
        rig.tick(4);
        rig.fake.forget();

        rig.report(track(2, 0), 10);
        rig.report(track(1, 500_000), 11);
        assert_eq!(rig.report(track(2, 5_000), 12), Some(rig.at(14)));
        rig.tick(14);

        let sets = rig.sets();
        assert_eq!(sets.len(), 1);
        assert_eq!(
            (sets[0].details.as_str(), sets[0].start_ms),
            ("Tide", 5_000)
        );
    }

    #[test]
    fn off_sends_nothing() {
        let mut rig = Rig::new();
        rig.enable(false);

        assert_eq!(rig.report(track(1, 0), 0), None);
        rig.tick(4);

        assert!(rig.fake.calls().is_empty());
    }

    #[test]
    fn turning_it_off_clears_and_closes_at_once() {
        let mut rig = Rig::new();
        rig.report(track(1, 0), 0);
        rig.tick(4);
        rig.fake.forget();

        rig.enable(false);
        rig.service.setting_changed();
        rig.tick(5);

        assert_eq!(rig.fake.calls(), [Call::Clear, Call::Close]);
    }

    #[test]
    fn turning_it_on_sends_what_is_playing_at_once() {
        let mut rig = Rig::new();
        rig.enable(false);
        rig.report(track(1, 0), 0);
        rig.tick(4);

        rig.enable(true);
        rig.service.setting_changed();
        rig.tick(60);

        assert_eq!(rig.sets().len(), 1);
    }

    #[test]
    fn a_failed_connect_retries_on_the_next_update_and_on_a_timer() {
        let mut rig = Rig::new();
        rig.fake.set_absent(true);
        rig.report(track(1, 0), 0);
        assert_eq!(rig.tick(4), Some(rig.at(34)));
        assert_eq!(rig.fake.calls(), [Call::Connect]);

        // The next update tries again rather than waiting out the timer.
        rig.report(track(2, 0), 10);
        assert_eq!(rig.tick(14), Some(rig.at(44)));

        // Discord starts; the timer finds it.
        rig.fake.set_absent(false);
        assert_eq!(rig.tick(44), None);

        assert_eq!(rig.sets().len(), 1);
        assert_eq!(rig.sets()[0].details, "Tide");
    }

    #[test]
    fn a_broken_pipe_is_dropped_and_reopened() {
        let mut rig = Rig::new();
        rig.report(track(1, 0), 0);
        rig.tick(4);
        rig.fake.set_absent(true);
        rig.fake.forget();

        rig.report(track(2, 0), 10);
        assert_eq!(rig.tick(14), Some(rig.at(44)));
        assert!(matches!(rig.fake.calls()[..], [Call::Set(_), Call::Close]));

        rig.fake.set_absent(false);
        rig.fake.forget();
        rig.tick(44);
        assert!(matches!(
            rig.fake.calls()[..],
            [Call::Connect, Call::Set(_)]
        ));
    }

    #[test]
    fn the_cover_is_the_release_group_then_the_release_then_the_logo() {
        let mut rig = Rig::new();
        rig.db
            .conn()
            .unwrap()
            .execute("UPDATE tracks SET release_mbid = 'mb-1' WHERE id = 2", [])
            .unwrap();

        rig.report(track(1, 0), 0);
        rig.tick(4);
        rig.report(track(2, 0), 10);
        rig.tick(14);
        rig.db
            .conn()
            .unwrap()
            .execute(
                "UPDATE tracks SET release_group_mbid = 'rg-1' WHERE id = 2",
                [],
            )
            .unwrap();
        rig.report(track(2, 60_000), 20);
        rig.tick(24);

        let images: Vec<_> = rig.sets().into_iter().map(|a| a.large_image).collect();
        assert_eq!(
            images,
            [
                LOGO.to_owned(),
                "https://coverartarchive.org/release/mb-1/front-500".to_owned(),
                "https://coverartarchive.org/release-group/rg-1/front-500".to_owned(),
            ]
        );
    }

    #[test]
    fn missing_tags_fall_back_as_the_row_shows_them() {
        let mut rig = Rig::new();
        rig.db
            .conn()
            .unwrap()
            .execute(
                "UPDATE tracks SET title = NULL, artist = NULL, album = NULL WHERE id = 1",
                [],
            )
            .unwrap();

        rig.report(track(1, 0), 0);
        rig.tick(4);

        let activity = &rig.sets()[0];
        assert_eq!(activity.details, "1.mp3");
        assert_eq!(activity.state, None);
        assert_eq!(activity.large_text, None);
    }

    #[test]
    fn text_is_clamped_into_discords_bounds() {
        assert_eq!(fit("A"), "A\u{200B}");
        assert_eq!(fit("  Harbour "), "Harbour");

        let long = "x".repeat(200);
        let fitted = fit(&long);
        assert_eq!(fitted.encode_utf16().count(), MAX_TEXT);
        assert!(fitted.ends_with('…'));

        // Counted in UTF-16 units, as Discord counts them: each of these is two.
        let wide = "𝄞".repeat(100);
        assert!(fit(&wide).encode_utf16().count() <= MAX_TEXT);
    }
}
