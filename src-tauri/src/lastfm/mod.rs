//! last.fm scrobbling.
//!
//! Opt-in, off by default, and inert with no account connected - with no
//! session key stored, nothing here opens a socket. See
//! `docs/plans/lastfm.md` for the decisions this shape comes from; the two
//! that explain most of it are that [`transport::Transport`] is the only thing
//! that touches the network, and that the session key is stored **unencrypted**
//! and labelled as such rather than obscured behind a constant compiled into
//! the binary.
//!
//! This module holds the vocabulary the rest of the feature shares: the error
//! taxonomy, and the one function that turns a response body into either a
//! value or one of those errors.

pub mod auth;
pub mod queue;
pub mod rules;
pub mod sign;
pub mod transport;

use std::sync::mpsc::{self, Sender};

use rusqlite::Connection;
use serde_json::Value;

use crate::db::{playback, Db};
use crate::error::{AppError, AppResult};
use rules::Scrobble;
use transport::{Transport, TransportError};

/// The key pair this build was compiled with.
///
/// **The secret is extractable from the binary and there is no way around
/// that**: last.fm's model requires a desktop client to carry one, every
/// open-source client that scrobbles ships one, and obscuring it would only
/// change how long it takes to find. What limits the damage is that the secret
/// alone is useless - scrobbling needs a session key, which is per account and
/// revocable by its owner.
#[derive(Debug, Clone, Copy)]
pub struct Credentials {
    pub api_key: &'static str,
    pub api_secret: &'static str,
}

/// The credentials, if this build has any.
///
/// Compiled in from the environment, so a build made without them - every
/// local build and every CI run - has the feature **inert** rather than
/// broken: the settings pane says the build carries no key, and nothing offers
/// to connect. A key is needed to run the feature, not to test it.
pub fn credentials() -> Option<Credentials> {
    match (
        option_env!("APEX_LASTFM_API_KEY"),
        option_env!("APEX_LASTFM_API_SECRET"),
    ) {
        (Some(api_key), Some(api_secret)) if !api_key.is_empty() && !api_secret.is_empty() => {
            Some(Credentials {
                api_key,
                api_secret,
            })
        }
        _ => None,
    }
}

/// The full parameter list for one signed call.
///
/// Order matters only to [`sign::api_sig`], which sorts for itself, so the
/// list is built in the order that reads best. `api_sig` and `format` are
/// appended **after** signing: the first cannot sign itself and the second is
/// excluded by the spec.
pub fn signed<'a>(
    method: &'a str,
    credentials: &'a Credentials,
    extra: Vec<(&'a str, String)>,
) -> Vec<(&'a str, String)> {
    let mut params = vec![
        ("method", method.to_owned()),
        ("api_key", credentials.api_key.to_owned()),
    ];
    params.extend(extra);

    let signature = sign::api_sig(&params, credentials.api_secret);
    params.push(("api_sig", signature));
    params.push(("format", "json".to_owned()));
    params
}

/// The error numbers this code branches on.
///
/// Only the ones with different consequences are named; everything else is a
/// malformed request, and the answer to those is to stop rather than to
/// classify them. The full list is at <https://www.last.fm/api/errorcodes>.
pub mod code {
    /// The stored session key no longer works. The user revoked the
    /// application, or last.fm invalidated it. Forget it and ask again.
    pub const INVALID_SESSION_KEY: u32 = 9;
    /// The service is temporarily off. Retry.
    pub const SERVICE_OFFLINE: u32 = 11;
    /// During the browser trip: the user has not said yes yet. Poll again.
    pub const TOKEN_NOT_AUTHORIZED: u32 = 14;
    /// During the browser trip: the token is past its hour. Start over.
    pub const TOKEN_EXPIRED: u32 = 15;
    /// The service is temporarily unavailable. Retry.
    pub const SERVICE_UNAVAILABLE: u32 = 16;
    /// Rate limited.
    ///
    /// Absent from the retry list in last.fm's own scrobbling guide, which is
    /// a gap in their documentation rather than a claim that it is permanent:
    /// no published request budget exists, and the condition is plainly
    /// temporary. Treated as retryable, with backoff.
    pub const RATE_LIMITED: u32 = 29;
}

/// What a last.fm call can come back as, other than the answer.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Transport(#[from] TransportError),

    /// The API's own error envelope, which usually arrives with HTTP 200.
    #[error("last.fm error {code}: {message}")]
    Api { code: u32, message: String },

    /// A body that is not the envelope.
    ///
    /// Not a theoretical case: `track.scrobble` with too few parameters
    /// answers **HTTP 200** with the legacy `text/plain` line `FAILED
    /// Incorrect protocol version…`, ignoring `format=json` entirely. A parser
    /// that assumed JSON on a 200 would panic or silently succeed; this is
    /// where that lands instead.
    #[error("last.fm sent something this build cannot read: {0}")]
    Malformed(String),
}

impl Error {
    /// Whether making the same call later could work.
    ///
    /// The allowlist is deliberate and short. last.fm's guidance is to retry
    /// 11 and 16 only; 29 is added because it is transient and their omission
    /// of it is an oversight. **Everything else is a malformed request** -
    /// retrying a bad signature or an unknown method forever is how a client
    /// gets itself banned, and a body we cannot parse will not parse next time
    /// either.
    pub fn transient(&self) -> bool {
        match self {
            Self::Transport(error) => error.transient(),
            Self::Api { code, .. } => matches!(
                *code,
                code::SERVICE_OFFLINE | code::SERVICE_UNAVAILABLE | code::RATE_LIMITED
            ),
            Self::Malformed(_) => false,
        }
    }

    /// Whether the stored session key has stopped working, so the only way
    /// forward is to forget it and let the user connect again.
    pub fn needs_reconnect(&self) -> bool {
        matches!(
            self,
            Self::Api {
                code: code::INVALID_SESSION_KEY,
                ..
            }
        )
    }

    /// The API error number, for the two callers that branch on a specific one.
    pub fn api_code(&self) -> Option<u32> {
        match self {
            Self::Api { code, .. } => Some(*code),
            _ => None,
        }
    }
}

impl From<Error> for AppError {
    fn from(error: Error) -> Self {
        Self::Internal(error.to_string())
    }
}

/// Reads a response body into a value, or into the error it describes.
///
/// **HTTP 200 does not mean success**, so every body goes through here
/// regardless of status - last.fm says so outright, and the error envelope is
/// what a rejected call looks like.
pub fn parse(body: &str) -> Result<serde_json::Value, Error> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|_| {
        // The body, not the parser's complaint: what is worth knowing is what
        // last.fm sent, and the legacy failure line says so in words.
        Error::Malformed(first_line(body))
    })?;

    if let Some(code) = value.get("error").and_then(serde_json::Value::as_u64) {
        return Err(Error::Api {
            code: code as u32,
            message: value
                .get("message")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("no message")
                .to_owned(),
        });
    }

    Ok(value)
}

/// The first line of a body, trimmed and capped.
///
/// An unreadable body can be an entire HTML page from a captive portal, and
/// the whole of it would reach an error popover and a log line.
fn first_line(body: &str) -> String {
    const CAP: usize = 200;
    let line = body.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        return "an empty response".to_owned();
    }
    match line.char_indices().nth(CAP) {
        Some((end, _)) => format!("{}…", &line[..end]),
        None => line.to_owned(),
    }
}

/// The most scrobbles one `track.scrobble` call may carry.
pub const BATCH_LIMIT: usize = 50;

/// What the app sends to last.fm, and when.
///
/// Owns the transport, so it is the only thing above [`transport`] that can
/// cause a request. Driven from one thread ([`Scrobbler`]), which is why every
/// method here is synchronous and takes `&self`.
///
/// **Inert with no account.** Every entry point reads the stored session first
/// and returns without a request when there is none, so an unconnected install
/// is not merely quiet - it never reaches the transport at all.
pub struct Service {
    db: Db,
    transport: Box<dyn Transport>,
    credentials: Credentials,
    /// How the window hears about the two things this thread decides on its
    /// own.
    ///
    /// A closure rather than a Tauri handle, like every other domain callback
    /// here, so the service stays testable with no running app.
    on_notice: Box<dyn Fn(Notice) + Send>,
    /// Wall clock, injected for the same reason the engine's is: the queue's
    /// whole behaviour is about *when* - backoff, the age limit - and a test
    /// that cannot move time can only assert that nothing happens yet.
    now: Box<dyn Fn() -> i64 + Send>,
}

/// Something the window should know, from a thread it has no handle on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Notice {
    /// The stored key was rejected and has been forgotten. Nothing the user
    /// did, so it is not an error - but the Account menu is claiming an
    /// account that no longer works until it is told.
    Disconnected,
    /// How many plays are waiting to be sent. Zero included: the settings pane
    /// has to be able to stop saying it.
    Queued(u32),
}

impl Service {
    pub fn new(
        db: Db,
        transport: Box<dyn Transport>,
        credentials: Credentials,
        on_notice: Box<dyn Fn(Notice) + Send>,
    ) -> Self {
        Self::with_clock(
            db,
            transport,
            credentials,
            on_notice,
            Box::new(crate::now_seconds),
        )
    }

    /// [`Service::new`], with the wall clock supplied. Tests move it; the app
    /// never calls this.
    pub fn with_clock(
        db: Db,
        transport: Box<dyn Transport>,
        credentials: Credentials,
        on_notice: Box<dyn Fn(Notice) + Send>,
        now: Box<dyn Fn() -> i64 + Send>,
    ) -> Self {
        Self {
            db,
            transport,
            credentials,
            on_notice,
            now,
        }
    }

    /// Announces what is playing now.
    ///
    /// **Fire and forget, and never retried.** It describes the present, so by
    /// the time a retry landed it would be describing a moment that has passed
    /// - which is also why last.fm says not to.
    pub fn now_playing(&self, track_id: i64, started_at: i64) -> AppResult<()> {
        let conn = self.db.conn()?;
        let Some((session, scrobble)) = self.prepare(&conn, track_id, started_at)? else {
            return Ok(());
        };

        let mut extra = vec![
            ("artist", scrobble.artist.clone()),
            ("track", scrobble.title.clone()),
            ("duration", scrobble.duration_seconds().to_string()),
            ("sk", session.key.clone()),
        ];
        if let Some(album) = scrobble.album.clone() {
            extra.push(("album", album));
        }

        self.call(
            &conn,
            signed("track.updateNowPlaying", &self.credentials, extra),
        )?;
        Ok(())
    }

    /// Records a play and then tries to send it.
    ///
    /// **Written down before it is sent, always.** A scrobble describes
    /// something that happened, and a closed laptop or a dropped connection
    /// should not cost the user their listening history - so the queue is the
    /// path rather than a fallback, and the difference between online and
    /// offline is only how long the row stays in it.
    ///
    /// **With no account there is nothing to write down.** Queuing plays made
    /// before an account existed would mean that connecting one posted weeks of
    /// listening the user never offered, which is the opposite of opt-in.
    pub fn played(&self, track_id: i64, started_at: i64) -> AppResult<()> {
        let conn = self.db.conn()?;
        let Some((_, scrobble)) = self.prepare(&conn, track_id, started_at)? else {
            return Ok(());
        };
        queue::enqueue(&conn, &scrobble, (self.now)())?;
        self.flush()
    }

    /// Sends whatever is due, oldest first, until nothing is or something
    /// stops it.
    ///
    /// Also what runs at startup, which is what makes "queued offline, flushed
    /// on the next launch" true without waiting for another play.
    pub fn flush(&self) -> AppResult<()> {
        let conn = self.db.conn()?;
        let Some(session) = auth::stored_session(&conn)? else {
            // Not connected: the queue keeps filling, and whatever is in it
            // goes out when an account arrives. Nothing is sent, and nothing
            // is thrown away for the lack of one.
            return Ok(());
        };

        loop {
            let now = (self.now)();
            let batch = queue::due(&conn, now, BATCH_LIMIT)?;
            if batch.is_empty() {
                break;
            }
            if !self.send_batch(&conn, &session.key, &batch, now)? {
                break;
            }
        }

        (self.on_notice)(Notice::Queued(queue::depth(&conn)?));
        Ok(())
    }

    /// One batch, and what to do with each row afterwards.
    ///
    /// Answers whether it is worth carrying on: a failure that the next batch
    /// would hit too - being offline, being rate limited - stops the drain
    /// rather than working through the queue failing every row in it.
    fn send_batch(
        &self,
        conn: &Connection,
        session_key: &str,
        batch: &[queue::Queued],
        now: i64,
    ) -> AppResult<bool> {
        let scrobbles: Vec<Scrobble> = batch.iter().map(|row| row.scrobble.clone()).collect();
        let ids: Vec<i64> = batch.iter().map(|row| row.id).collect();

        let outcome = self.submit(conn, session_key, &scrobbles);
        match outcome {
            Ok(Some(codes)) => {
                // Accepted and permanently refused are both finished with; only
                // the daily cap is worth offering again, and not today.
                let mut again: Vec<i64> = Vec::new();
                let mut done: Vec<i64> = Vec::new();
                for (id, code) in ids.iter().zip(&codes) {
                    if ignore_is_temporary(*code) {
                        again.push(*id);
                    } else {
                        done.push(*id);
                    }
                }
                queue::forget(conn, &done)?;
                queue::defer(conn, &again, now)?;
                // A batch that was entirely capped will be capped again.
                Ok(again.len() < codes.len())
            }
            // A response that does not describe the batch: the plays may or may
            // not have landed, and guessing either way is worse than trying
            // again later.
            Ok(None) => {
                queue::defer(conn, &ids, now)?;
                Ok(false)
            }
            Err(error) if error.transient() => {
                queue::defer(conn, &ids, now)?;
                Ok(false)
            }
            // A malformed request, a bad signature, a dead key. Sending it
            // again produces the same answer forever, which is how a client
            // gets itself banned.
            Err(_) => {
                queue::forget(conn, &ids)?;
                Ok(false)
            }
        }
    }

    /// Sends a batch, reporting how last.fm treated each scrobble in it.
    ///
    /// `None` in place of the codes means the response did not describe the
    /// batch at all; see [`outcomes`].
    fn submit(
        &self,
        conn: &Connection,
        session_key: &str,
        batch: &[Scrobble],
    ) -> Result<Option<Vec<u32>>, Error> {
        // Held here and borrowed into the parameter list: the names are
        // indexed, so unlike every other call they cannot be `&'static str`.
        let owned = scrobble_params(batch, session_key);
        let extra: Vec<(&str, String)> = owned
            .iter()
            .map(|(name, value)| (name.as_str(), value.clone()))
            .collect();

        let value = self.call(conn, signed("track.scrobble", &self.credentials, extra))?;
        Ok(outcomes(&value, batch.len()))
    }

    /// The session and the scrobble, or nothing to do.
    ///
    /// Three ways to have nothing to do, none of them an error: no account, a
    /// track the library no longer has, and a play [`rules`] would not send.
    fn prepare(
        &self,
        conn: &Connection,
        track_id: i64,
        started_at: i64,
    ) -> AppResult<Option<(auth::Session, Scrobble)>> {
        let Some(session) = auth::stored_session(conn)? else {
            return Ok(None);
        };
        let Some(track) = playback::track_by_id(conn, track_id)? else {
            return Ok(None);
        };
        Ok(rules::scrobbleable(&track, started_at).map(|scrobble| (session, scrobble)))
    }

    /// One call, with the consequence that is not the caller's business
    /// already applied.
    ///
    /// A dead session key is not a failed request to be retried, it is an
    /// account that is no longer connected - so it is forgotten here, once,
    /// rather than at each of the call sites.
    fn call(&self, conn: &Connection, params: Vec<(&str, String)>) -> Result<Value, Error> {
        let outcome = self
            .transport
            .post(&params)
            .map_err(Error::from)
            .and_then(|body| parse(&body));

        if outcome.as_ref().err().is_some_and(Error::needs_reconnect) {
            // Revoked from last.fm's own settings screen, or invalidated. A
            // failed write here would leave the app retrying with a key it
            // already knows is dead, so it is not worth failing over either.
            let _ = auth::forget_session(conn);
            (self.on_notice)(Notice::Disconnected);
        }

        outcome
    }
}

/// The indexed parameters for a batch of scrobbles.
///
/// Array notation even for one, so the single and the batched path are the same
/// request shape - and so the ASCII ordering `sign` has to get right is
/// exercised by every scrobble rather than only by a queue flush.
fn scrobble_params(batch: &[Scrobble], session_key: &str) -> Vec<(String, String)> {
    let mut params = vec![("sk".to_owned(), session_key.to_owned())];
    for (index, scrobble) in batch.iter().enumerate() {
        params.push((format!("artist[{index}]"), scrobble.artist.clone()));
        params.push((format!("track[{index}]"), scrobble.title.clone()));
        params.push((
            format!("timestamp[{index}]"),
            scrobble.started_at.to_string(),
        ));
        params.push((
            format!("duration[{index}]"),
            scrobble.duration_seconds().to_string(),
        ));
        if let Some(album) = &scrobble.album {
            params.push((format!("album[{index}]"), album.clone()));
        }
    }
    params
}

/// The ignore code the daily cap arrives as.
///
/// **The only ignore reason that is temporary.** An ignored artist or track (1,
/// 2) and a timestamp too far past or future (3, 4) will be ignored the same
/// way forever; a scrobble refused for today's limit is worth offering again
/// tomorrow, with the timestamp it already has.
pub const IGNORE_DAILY_LIMIT: u32 = 5;

/// Whether a scrobble last.fm refused is worth keeping.
pub fn ignore_is_temporary(code: u32) -> bool {
    code == IGNORE_DAILY_LIMIT
}

/// How last.fm treated each scrobble of a batch; zero means accepted.
///
/// **An `ok` response does not mean every scrobble landed.** The daily cap
/// arrives as an `ignoredMessage` on an individual scrobble inside an otherwise
/// successful response, so a batch can be partly rejected while the top-level
/// status says nothing about it. Codes 1 and 2 are an ignored artist or track,
/// 3 and 4 a timestamp too far past or future, 5 the daily cap.
///
/// `None` when the response does not describe the batch at all - a body with no
/// `scrobbles` in it, or one describing a different number of them. That is the
/// case where assuming success would throw plays away silently, and it is the
/// reason this reads the array rather than the top-level status.
///
/// Note the codes arrive as **strings**, not numbers, unlike the `error` field.
pub fn outcomes(value: &Value, sent: usize) -> Option<Vec<u32>> {
    let scrobbles = &value["scrobbles"]["scrobble"];
    let entries = match scrobbles {
        Value::Array(items) => items.iter().collect::<Vec<_>>(),
        // One scrobble comes back as an object rather than an array of one.
        Value::Object(_) => vec![scrobbles],
        _ => return None,
    };
    if entries.len() != sent {
        return None;
    }

    Some(entries.into_iter().map(ignored_code).collect())
}

/// The ignore code on one scrobble; zero means it was accepted.
///
/// Absent reads as accepted: last.fm sends `"code": "0"` for a good scrobble,
/// and a response that omits the field entirely is not describing a rejection.
fn ignored_code(entry: &Value) -> u32 {
    entry["ignoredMessage"]["code"]
        .as_str()
        .and_then(|code| code.parse().ok())
        .unwrap_or(0)
}

/// One thing for the scrobbler thread to do.
enum Job {
    NowPlaying {
        track_id: i64,
        started_at: i64,
    },
    Played {
        track_id: i64,
        started_at: i64,
    },
    /// Send whatever the queue has been holding. Sent once at startup, which
    /// is what makes "queued offline, sent on the next launch" true without
    /// waiting for another play.
    Flush,
}

/// Handle to the scrobbler thread.
///
/// The same shape as [`crate::audio::Player`], and for the same reason: the
/// work is blocking, the caller must never wait on it, and the thread that
/// produces the events - the player thread - is the one thread in the app that
/// must not stall. Sending is fire-and-forget.
pub struct Scrobbler {
    jobs: Sender<Job>,
}

impl Scrobbler {
    /// Starts the thread, or does not exist.
    ///
    /// `None` in a build with no API key compiled in, which is every local
    /// build and every CI run: no thread, no channel, and the caller's `Option`
    /// is what makes "no code-path change" literally true rather than merely
    /// quiet.
    pub fn start(db: Db, on_notice: Box<dyn Fn(Notice) + Send>) -> Option<Self> {
        let credentials = credentials()?;
        let transport = transport::HttpTransport::new(transport::USER_AGENT).ok()?;
        Some(Self::spawn(Service::new(
            db,
            Box::new(transport),
            credentials,
            on_notice,
        )))
    }

    pub fn spawn(service: Service) -> Self {
        let (jobs, rx) = mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name("scrobbler".to_owned())
            .spawn(move || {
                // Ends when every sender is gone, which is the app shutting
                // down.
                while let Ok(job) = rx.recv() {
                    // Nothing here was asked for by the user, so nothing here
                    // reports. The one consequence that matters - a dead
                    // session key being forgotten - is applied inside the
                    // service and reaches the window on its own channel.
                    let _ = match job {
                        Job::NowPlaying {
                            track_id,
                            started_at,
                        } => service.now_playing(track_id, started_at),
                        Job::Played {
                            track_id,
                            started_at,
                        } => service.played(track_id, started_at),
                        Job::Flush => service.flush(),
                    };
                }
            })
            .expect("spawning the scrobbler thread");

        let scrobbler = Self { jobs };
        // Before anything plays: a queue left behind by the last session is
        // the case this whole phase exists for, and waiting for the next song
        // to drain it would mean an app closed after one is never drained.
        scrobbler.flush();
        scrobbler
    }

    /// Asks the thread to drain the queue.
    pub fn flush(&self) {
        let _ = self.jobs.send(Job::Flush);
    }

    pub fn now_playing(&self, track_id: i64, started_at: i64) {
        // A scrobbler thread that has gone away is not worth failing playback
        // over.
        let _ = self.jobs.send(Job::NowPlaying {
            track_id,
            started_at,
        });
    }

    pub fn played(&self, track_id: i64, started_at: i64) {
        let _ = self.jobs.send(Job::Played {
            track_id,
            started_at,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- the service ----
    //
    // Everything below runs against `FakeTransport`, which answers from a
    // script and records what it was asked. No socket is opened, and the bodies
    // include the ones no real server would produce on demand: a rate limit, a
    // dead session key, a partly-ignored batch, and the legacy `text/plain`
    // reply that arrives with HTTP 200.

    use crate::db::{settings, Db};
    use crate::lastfm::transport::{FakeTransport, TransportError};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    const TEST_CREDENTIALS: Credentials = Credentials {
        api_key: "KEY",
        api_secret: "SECRET",
    };

    /// A library with one well-tagged four-minute track, id 1.
    fn library() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        conn.execute(
            "INSERT INTO tracks (id, path, mtime, size, duration_ms, title, artist, album, added_at)
             VALUES (1, 'C:\\music\\1.mp3', 0, 0, 240000, 'Harbour', 'Blue Room', 'Coastline', 0)",
            [],
        )
        .unwrap();
        (dir, db)
    }

    fn connect(db: &Db) {
        let conn = db.conn().unwrap();
        auth::store_session(
            &conn,
            &auth::Session {
                username: "listener".to_owned(),
                key: "sk-1".to_owned(),
            },
        )
        .unwrap();
    }

    /// A clock the test moves, shared with the service driving it.
    #[derive(Clone)]
    struct TestClock(Arc<std::sync::atomic::AtomicI64>);

    impl TestClock {
        fn new(at: i64) -> Self {
            Self(Arc::new(std::sync::atomic::AtomicI64::new(at)))
        }
        fn advance(&self, seconds: i64) {
            self.0.fetch_add(seconds, Ordering::SeqCst);
        }
        fn now(&self) -> i64 {
            self.0.load(Ordering::SeqCst)
        }
    }

    /// What a test can see of a service without a running app: the notices it
    /// sent, and the clock it reads.
    struct Watched {
        service: Service,
        disconnects: Arc<AtomicUsize>,
        clock: TestClock,
    }

    /// A service over `transport`, at a fixed moment.
    ///
    /// `PLAY_AT` rather than a real clock because the queue is entirely about
    /// *when* - the backoff, the two-week age limit - and a fixed present is
    /// what makes those assertable at all.
    fn service(db: Db, transport: FakeTransport) -> Watched {
        let clock = TestClock::new(PLAY_AT);
        let disconnects = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&disconnects);
        let reading = clock.clone();
        let service = Service::with_clock(
            db,
            Box::new(transport),
            TEST_CREDENTIALS,
            Box::new(move |notice| {
                if notice == Notice::Disconnected {
                    seen.fetch_add(1, Ordering::SeqCst);
                }
            }),
            Box::new(move || reading.now()),
        );
        Watched {
            service,
            disconnects,
            clock,
        }
    }

    /// When the tests below are pretending to be.
    const PLAY_AT: i64 = 1_700_000_000;

    /// A `track.scrobble` response taking every scrobble of a batch of `count`.
    fn ok_batch(count: usize) -> String {
        let entries: Vec<String> = (0..count)
            .map(|_| r##"{"ignoredMessage":{"code":"0","#text":""}}"##.to_owned())
            .collect();
        format!(
            r#"{{"scrobbles":{{"@attr":{{"accepted":{count},"ignored":0}},"scrobble":[{}]}}}}"#,
            entries.join(",")
        )
    }

    /// A response taking the first scrobble and refusing the second for the
    /// day - the shape that made reading the top-level status a bug.
    fn one_capped_of_two() -> String {
        r##"{"scrobbles":{"@attr":{"accepted":1,"ignored":1},"scrobble":[
            {"ignoredMessage":{"code":"0","#text":""}},
            {"ignoredMessage":{"code":"5","#text":"Daily scrobble limit exceeded"}}
        ]}}"##
            .to_owned()
    }

    /// A response refusing one scrobble for good: ignore code 1, an artist
    /// last.fm will not match.
    fn one_ignored() -> String {
        r##"{"scrobbles":{"@attr":{"accepted":0,"ignored":1},"scrobble":{"ignoredMessage":{"code":"1","#text":"Artist was ignored"}}}}"##
            .to_owned()
    }

    /// How many plays are still waiting to be sent.
    fn waiting(db: &Db) -> u32 {
        queue::depth(&db.conn().unwrap()).unwrap()
    }

    const OK_SCROBBLE: &str = r##"{"scrobbles":{"@attr":{"accepted":1,"ignored":0},"scrobble":{"ignoredMessage":{"code":"0","#text":""}}}}"##;

    #[test]
    fn an_unconnected_install_sends_nothing_at_all() {
        // The whole product promise of this feature in one assertion: with no
        // account, the transport is never reached. Not "sends an empty
        // request", not "sends and is rejected" - never called. A transport
        // with an empty script panics on any call, so a clean run is already
        // the assertion; the log says so without relying on that.
        let (_dir, db) = library();
        let transport = FakeTransport::scripted(Vec::new());
        let log = transport.log();

        let watched = service(db.clone(), transport);
        watched.service.played(1, PLAY_AT).unwrap();
        watched.service.now_playing(1, PLAY_AT).unwrap();

        assert_eq!(log.count(), 0);
        // And not queued either. Keeping them would mean that connecting an
        // account later posted weeks of listening the user never offered - the
        // opposite of opt-in.
        assert_eq!(waiting(&db), 0);
    }

    #[test]
    fn a_played_track_is_scrobbled_with_the_time_it_started() {
        let (_dir, db) = library();
        connect(&db);
        let transport = FakeTransport::always(OK_SCROBBLE);
        let log = transport.log();

        let watched = service(db.clone(), transport);
        watched.service.played(1, PLAY_AT).unwrap();

        let param = |name: &str| log.param(0, name);
        assert_eq!(param("method").as_deref(), Some("track.scrobble"));
        assert_eq!(param("artist[0]").as_deref(), Some("Blue Room"));
        assert_eq!(param("track[0]").as_deref(), Some("Harbour"));
        assert_eq!(param("album[0]").as_deref(), Some("Coastline"));
        // Seconds, not milliseconds, and the start rather than the moment the
        // threshold was crossed.
        assert_eq!(param("timestamp[0]").as_deref(), Some("1700000000"));
        assert_eq!(param("duration[0]").as_deref(), Some("240"));
        assert_eq!(param("sk").as_deref(), Some("sk-1"));
        // And it is gone from the queue, because last.fm took it.
        assert_eq!(waiting(&db), 0);
    }

    #[test]
    fn now_playing_describes_the_present_and_carries_no_timestamp() {
        let (_dir, db) = library();
        connect(&db);
        let transport = FakeTransport::always(r#"{"nowplaying":{}}"#);
        let log = transport.log();

        let watched = service(db, transport);
        watched.service.now_playing(1, PLAY_AT).unwrap();

        assert_eq!(
            log.param(0, "method").as_deref(),
            Some("track.updateNowPlaying")
        );
        // Nothing dated: it describes the present, and last.fm takes no
        // timestamp for it.
        assert!(!log.names(0).iter().any(|name| name.contains("timestamp")));
        assert_eq!(log.param(0, "duration").as_deref(), Some("240"));
        assert_eq!(log.param(0, "album").as_deref(), Some("Coastline"));
    }

    #[test]
    fn a_track_the_rules_reject_never_reaches_the_transport() {
        let (_dir, db) = library();
        connect(&db);
        {
            let conn = db.conn().unwrap();
            conn.execute("UPDATE tracks SET artist = NULL WHERE id = 1", [])
                .unwrap();
        }

        let watched = service(db.clone(), FakeTransport::scripted(Vec::new()));
        watched.service.played(1, PLAY_AT).unwrap();
        watched.service.now_playing(1, PLAY_AT).unwrap();

        // Not queued either: a play last.fm could not have matched is not a
        // play worth keeping.
        assert_eq!(waiting(&db), 0);
    }

    #[test]
    fn a_track_the_library_no_longer_has_is_not_an_error() {
        let (_dir, db) = library();
        connect(&db);
        let watched = service(db.clone(), FakeTransport::scripted(Vec::new()));

        watched.service.played(999, PLAY_AT).unwrap();
        assert_eq!(waiting(&db), 0);
    }

    #[test]
    fn a_dead_session_key_is_forgotten_and_reported_once() {
        let (_dir, db) = library();
        connect(&db);
        let transport = FakeTransport::always(
            r#"{"error":9,"message":"Invalid session key - Please re-authenticate"}"#,
        );

        let watched = service(db.clone(), transport);
        watched.service.played(1, PLAY_AT).unwrap();

        let conn = db.conn().unwrap();
        assert_eq!(auth::stored_session(&conn).unwrap(), None);
        assert_eq!(watched.disconnects.load(Ordering::SeqCst), 1);
        // Dropped rather than queued: resending under a key already known to
        // be dead is how a client gets itself banned.
        assert_eq!(waiting(&db), 0);
    }

    #[test]
    fn a_transient_failure_leaves_the_account_connected() {
        // The difference that matters: being offline is not being logged out,
        // and forgetting a good session key because of a dropped connection
        // would make the user reconnect every time their network hiccuped.
        let (_dir, db) = library();
        connect(&db);

        for body in [
            Err(TransportError::Unreachable("connection refused".to_owned())),
            Ok(r#"{"error":29,"message":"Rate limit exceeded"}"#.to_owned()),
            Ok(r#"{"error":16,"message":"The service is temporarily unavailable"}"#.to_owned()),
        ] {
            let watched = service(db.clone(), FakeTransport::scripted(vec![body]));
            watched.service.played(1, PLAY_AT).unwrap();

            let conn = db.conn().unwrap();
            assert!(auth::stored_session(&conn).unwrap().is_some());
            assert_eq!(watched.disconnects.load(Ordering::SeqCst), 0);
            // And the play is kept, which is the other half of the same
            // judgement: temporarily unreachable is not permanently refused.
            assert_eq!(queue::depth(&conn).unwrap(), 1);
            conn.execute("DELETE FROM scrobble_queue", []).unwrap();
        }
    }

    #[test]
    fn a_request_last_fm_will_never_accept_is_dropped_rather_than_retried() {
        // HTTP 200, `text/plain`, and `format=json` ignored entirely - which is
        // what `track.scrobble` answers a request it cannot read. Keeping the
        // row would mean sending the same unreadable request until the age
        // limit dropped it, which is how a client gets itself banned.
        let (_dir, db) = library();
        connect(&db);
        let watched = service(
            db.clone(),
            FakeTransport::scripted(vec![Ok(
                "FAILED Incorrect protocol version. Please update your client.".to_owned(),
            )]),
        );

        watched.service.played(1, PLAY_AT).unwrap();

        assert_eq!(waiting(&db), 0);
        // But the account is untouched: an unreadable answer is not a rejected
        // key.
        assert!(auth::stored_session(&db.conn().unwrap()).unwrap().is_some());
    }

    #[test]
    fn a_play_made_offline_goes_out_on_the_next_success() {
        // The behaviour the queue exists for, end to end: one play while the
        // network is down, another once it is back, and both reach last.fm -
        // the older one first.
        let (_dir, db) = library();
        connect(&db);
        let transport = FakeTransport::scripted(vec![
            Err(TransportError::Unreachable("connection refused".to_owned())),
            Ok(ok_batch(2)),
        ]);
        let log = transport.log();
        let watched = service(db.clone(), transport);

        watched.service.played(1, PLAY_AT).unwrap();
        assert_eq!(waiting(&db), 1, "the offline play is kept");

        // A track later, and past the first backoff - which in practice is any
        // second song, since the shortest scrobbleable one is thirty seconds
        // and the delay is sixty.
        watched.clock.advance(300);
        watched.service.played(1, PLAY_AT + 300).unwrap();

        assert_eq!(log.count(), 2);
        // Both in one batch, oldest first.
        assert_eq!(log.param(1, "timestamp[0]").as_deref(), Some("1700000000"));
        assert_eq!(log.param(1, "timestamp[1]").as_deref(), Some("1700000300"));
        assert_eq!(waiting(&db), 0);
    }

    #[test]
    fn a_batch_the_daily_cap_partly_refused_keeps_only_what_was_refused() {
        // The failure the plan names: a top-level `ok` with one scrobble
        // ignored inside it. Reading the status alone would mark both sent.
        let (_dir, db) = library();
        connect(&db);
        let transport = FakeTransport::scripted(vec![
            Err(TransportError::Unreachable("offline".to_owned())),
            Ok(one_capped_of_two()),
        ]);
        let watched = service(db.clone(), transport);

        watched.service.played(1, PLAY_AT).unwrap();
        watched.clock.advance(300);
        watched.service.played(1, PLAY_AT + 300).unwrap();

        // The accepted one is gone; the capped one is still waiting for
        // tomorrow.
        assert_eq!(waiting(&db), 1);
        let conn = db.conn().unwrap();
        let left = queue::due(&conn, PLAY_AT + 300 + 100_000, BATCH_LIMIT).unwrap();
        assert_eq!(left[0].scrobble.started_at, PLAY_AT + 300);
    }

    #[test]
    fn a_scrobble_last_fm_will_never_match_is_not_kept() {
        // Ignore code 1, an artist last.fm refuses. Unlike the daily cap it
        // will be refused the same way forever, so the row goes.
        let (_dir, db) = library();
        connect(&db);
        let watched = service(db.clone(), FakeTransport::scripted(vec![Ok(one_ignored())]));

        watched.service.played(1, PLAY_AT).unwrap();

        assert_eq!(waiting(&db), 0);
    }

    #[test]
    fn a_response_that_does_not_describe_the_batch_keeps_the_plays() {
        // Neither accepted nor refused, as far as this build can tell. Guessing
        // "sent" throws plays away silently, which is the whole reason
        // `outcomes` is an `Option`.
        let (_dir, db) = library();
        connect(&db);
        let watched = service(
            db.clone(),
            FakeTransport::scripted(vec![Ok(r#"{"scrobbles":{}}"#.to_owned())]),
        );

        watched.service.played(1, PLAY_AT).unwrap();

        assert_eq!(waiting(&db), 1);
    }

    #[test]
    fn a_queue_longer_than_one_batch_drains_in_batches() {
        let (_dir, db) = library();
        connect(&db);
        {
            let conn = db.conn().unwrap();
            for offset in 0..(BATCH_LIMIT as i64 + 5) {
                queue::enqueue(
                    &conn,
                    &rules::Scrobble {
                        artist: "Blue Room".to_owned(),
                        title: format!("Harbour {offset}"),
                        album: None,
                        duration_ms: 240_000,
                        started_at: PLAY_AT - offset,
                    },
                    PLAY_AT,
                )
                .unwrap();
            }
        }
        // Scripted rather than repeating: the two calls carry different
        // numbers of scrobbles, and a response has to describe the batch it
        // answers or `outcomes` refuses to read it.
        let transport = FakeTransport::scripted(vec![Ok(ok_batch(BATCH_LIMIT)), Ok(ok_batch(5))]);
        let log = transport.log();
        let watched = service(db.clone(), transport);

        watched.service.flush().unwrap();

        // Fifty then five, rather than fifty-five in one call last.fm would
        // refuse.
        assert_eq!(log.count(), 2);
        assert!(log.names(0).iter().any(|name| name == "artist[49]"));
        assert!(!log.names(0).iter().any(|name| name == "artist[50]"));
        assert_eq!(waiting(&db), 0);
    }

    #[test]
    fn nothing_is_sent_for_an_empty_queue() {
        let (_dir, db) = library();
        connect(&db);
        let transport = FakeTransport::scripted(Vec::new());
        let log = transport.log();
        let watched = service(db, transport);

        watched.service.flush().unwrap();

        assert_eq!(log.count(), 0);
    }

    #[test]
    fn the_session_key_is_the_only_secret_that_leaves_and_it_is_signed_for() {
        let (_dir, db) = library();
        connect(&db);
        let transport = FakeTransport::always(OK_SCROBBLE);
        let log = transport.log();

        let watched = service(db, transport);
        watched.service.played(1, PLAY_AT).unwrap();

        // The plan's promise, as a list: no path, no folder, no library size,
        // nothing about the machine.
        assert!(!log.names(0).iter().any(|name| name.contains("path")));
        for (name, value) in &log.calls()[0] {
            assert!(
                !value.contains("music"),
                "{name} carried something about the filesystem off the machine"
            );
        }
    }

    #[test]
    fn a_partly_ignored_batch_is_read_per_scrobble_rather_than_by_its_status() {
        // The daily cap arrives inside an otherwise successful response, on one
        // scrobble of several. A reader that looked at the top-level status
        // would call this a clean success.
        let value: Value = serde_json::from_str(
            r##"{"scrobbles":{"@attr":{"accepted":1,"ignored":1},"scrobble":[
                {"ignoredMessage":{"code":"0","#text":""}},
                {"ignoredMessage":{"code":"5","#text":"Daily scrobble limit exceeded"}}
            ]}}"##,
        )
        .unwrap();

        assert_eq!(outcomes(&value, 2), Some(vec![0, IGNORE_DAILY_LIMIT]));
    }

    #[test]
    fn one_scrobble_comes_back_as_an_object_rather_than_an_array_of_one() {
        let value: Value = serde_json::from_str(OK_SCROBBLE).unwrap();
        assert_eq!(outcomes(&value, 1), Some(vec![0]));
    }

    #[test]
    fn a_response_that_does_not_describe_the_batch_answers_nothing() {
        // Not "all accepted". This is the case where guessing would throw plays
        // away, and it is why the flags are an `Option`.
        let empty: Value = serde_json::from_str("{}").unwrap();
        assert_eq!(outcomes(&empty, 1), None);

        let short: Value =
            serde_json::from_str(r#"{"scrobbles":{"scrobble":[{"ignoredMessage":{"code":"0"}}]}}"#)
                .unwrap();
        assert_eq!(outcomes(&short, 2), None);
    }

    #[test]
    fn a_scrobble_with_no_album_omits_it_rather_than_sending_a_blank() {
        let params = scrobble_params(
            &[Scrobble {
                artist: "Blue Room".to_owned(),
                title: "Harbour".to_owned(),
                album: None,
                duration_ms: 240_000,
                started_at: 1,
            }],
            "sk-1",
        );
        assert!(!params.iter().any(|(name, _)| name.starts_with("album")));
    }

    #[test]
    fn a_batch_indexes_every_scrobble_it_carries() {
        let one = |n: i64| Scrobble {
            artist: format!("Artist {n}"),
            title: format!("Title {n}"),
            album: None,
            duration_ms: 240_000,
            started_at: n,
        };
        let batch: Vec<Scrobble> = (0..BATCH_LIMIT as i64).map(one).collect();

        let params = scrobble_params(&batch, "sk-1");
        assert_eq!(
            params
                .iter()
                .filter(|(name, _)| name.starts_with("artist["))
                .count(),
            BATCH_LIMIT
        );
        assert!(params.contains(&("artist[49]".to_owned(), "Artist 49".to_owned())));
        // And the signature over them sorts `artist[10]` before `artist[1]`,
        // which `sign::tests` pins as its own vector.
    }

    #[test]
    fn a_scrobble_never_reaches_an_export() {
        let (_dir, db) = library();
        connect(&db);
        let conn = db.conn().unwrap();

        let exported = settings::exportable(&conn).unwrap();
        assert!(!exported.iter().any(|(_, value)| value == "sk-1"));
    }

    #[test]
    fn reads_a_successful_body() {
        let value = parse(r#"{"session":{"name":"listener","key":"abc"}}"#).unwrap();
        assert_eq!(value["session"]["key"], "abc");
    }

    #[test]
    fn turns_the_error_envelope_into_an_error() {
        let error = parse(r#"{"error":6,"message":"Invalid parameters"}"#).unwrap_err();
        assert!(matches!(
            error,
            Error::Api {
                code: 6,
                ref message
            } if message == "Invalid parameters"
        ));
    }

    #[test]
    fn an_envelope_without_a_message_still_carries_its_code() {
        let error = parse(r#"{"error":29}"#).unwrap_err();
        assert_eq!(error.api_code(), Some(code::RATE_LIMITED));
    }

    #[test]
    fn survives_the_legacy_plain_text_two_hundred() {
        // The reply `track.scrobble` gives a request with too few parameters:
        // HTTP 200, `text/plain`, and `format=json` ignored. Nothing about the
        // status says the request failed.
        let error =
            parse("FAILED Incorrect protocol version. Please update your client.\n").unwrap_err();

        assert!(matches!(error, Error::Malformed(_)));
        assert!(error.to_string().contains("FAILED Incorrect protocol"));
        assert!(
            !error.transient(),
            "a malformed request is not worth a retry"
        );
    }

    #[test]
    fn an_unreadable_body_is_reported_by_its_first_line_and_capped() {
        let error = parse(&format!("<html>{}</html>\nmore", "x".repeat(500))).unwrap_err();
        // Enough to recognise, not enough to fill a popover with a web page.
        assert!(error.to_string().len() < 260, "{error}");
        assert!(!error.to_string().contains("more"));
    }

    #[test]
    fn an_empty_body_says_so_rather_than_reporting_nothing() {
        let error = parse("").unwrap_err();
        assert!(error.to_string().contains("an empty response"));
    }

    #[test]
    fn only_the_three_transient_codes_are_worth_retrying() {
        let api = |code| Error::Api {
            code,
            message: String::new(),
        };

        for code in [
            code::SERVICE_OFFLINE,
            code::SERVICE_UNAVAILABLE,
            code::RATE_LIMITED,
        ] {
            assert!(api(code).transient(), "{code} should be retried");
        }
        // Every other error is a request that will fail the same way forever:
        // 4 bad token, 6 bad parameters, 9 dead session key, 13 bad signature,
        // 26 suspended key.
        for code in [4, 6, code::INVALID_SESSION_KEY, 13, 26] {
            assert!(!api(code).transient(), "{code} should not be retried");
        }
    }

    #[test]
    fn a_dead_session_key_asks_for_a_reconnect_and_nothing_else_does() {
        let dead = Error::Api {
            code: code::INVALID_SESSION_KEY,
            message: "Invalid session key - Please re-authenticate".to_owned(),
        };
        assert!(dead.needs_reconnect());

        assert!(!Error::Api {
            code: code::RATE_LIMITED,
            message: String::new()
        }
        .needs_reconnect());
        assert!(!Error::Malformed("x".to_owned()).needs_reconnect());
    }

    #[test]
    fn an_unreachable_host_is_transient_and_carries_through_the_taxonomy() {
        let error = Error::from(TransportError::Unreachable("connection refused".to_owned()));
        assert!(error.transient());
        assert!(!error.needs_reconnect());
        assert_eq!(error.api_code(), None);
    }
}
