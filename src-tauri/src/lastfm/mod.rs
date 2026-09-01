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
    /// Called when a session key turns out to be dead and is forgotten.
    ///
    /// A closure rather than a Tauri handle, like every other domain callback
    /// here, so the service stays testable with no running app.
    on_disconnected: Box<dyn Fn() + Send>,
}

impl Service {
    pub fn new(
        db: Db,
        transport: Box<dyn Transport>,
        credentials: Credentials,
        on_disconnected: Box<dyn Fn() + Send>,
    ) -> Self {
        Self {
            db,
            transport,
            credentials,
            on_disconnected,
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

    /// Submits one play.
    pub fn played(&self, track_id: i64, started_at: i64) -> AppResult<()> {
        let conn = self.db.conn()?;
        let Some((session, scrobble)) = self.prepare(&conn, track_id, started_at)? else {
            return Ok(());
        };
        self.submit(&conn, &session.key, &[scrobble])?;
        Ok(())
    }

    /// Sends a batch, reporting which of them last.fm took.
    ///
    /// `None` in place of the flags means the response did not describe the
    /// batch at all; see [`accepted`].
    fn submit(
        &self,
        conn: &Connection,
        session_key: &str,
        batch: &[Scrobble],
    ) -> Result<Option<Vec<bool>>, Error> {
        // Held here and borrowed into the parameter list: the names are
        // indexed, so unlike every other call they cannot be `&'static str`.
        let owned = scrobble_params(batch, session_key);
        let extra: Vec<(&str, String)> = owned
            .iter()
            .map(|(name, value)| (name.as_str(), value.clone()))
            .collect();

        let value = self.call(conn, signed("track.scrobble", &self.credentials, extra))?;
        Ok(accepted(&value, batch.len()))
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
            (self.on_disconnected)();
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

/// Which scrobbles of a batch last.fm actually took.
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
pub fn accepted(value: &Value, sent: usize) -> Option<Vec<bool>> {
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

    Some(
        entries
            .into_iter()
            .map(|entry| ignored_code(entry) == 0)
            .collect(),
    )
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
    NowPlaying { track_id: i64, started_at: i64 },
    Played { track_id: i64, started_at: i64 },
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
    pub fn start(db: Db, on_disconnected: Box<dyn Fn() + Send>) -> Option<Self> {
        let credentials = credentials()?;
        let transport = transport::HttpTransport::new(transport::USER_AGENT).ok()?;
        Some(Self::spawn(Service::new(
            db,
            Box::new(transport),
            credentials,
            on_disconnected,
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
                    };
                }
            })
            .expect("spawning the scrobbler thread");
        Self { jobs }
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

    /// A service over `transport`, plus a counter of how often it reported the
    /// account as gone.
    fn service(db: Db, transport: FakeTransport) -> (Service, Arc<AtomicUsize>) {
        let disconnects = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&disconnects);
        let service = Service::new(
            db,
            Box::new(transport),
            TEST_CREDENTIALS,
            Box::new(move || {
                seen.fetch_add(1, Ordering::SeqCst);
            }),
        );
        (service, disconnects)
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

        let (service, _) = service(db, transport);
        service.played(1, 1_700_000_000).unwrap();
        service.now_playing(1, 1_700_000_000).unwrap();

        assert_eq!(log.count(), 0);
    }

    #[test]
    fn a_played_track_is_scrobbled_with_the_time_it_started() {
        let (_dir, db) = library();
        connect(&db);
        let transport = FakeTransport::always(OK_SCROBBLE);
        let log = transport.log();

        let (service, _) = service(db, transport);
        service.played(1, 1_700_000_000).unwrap();

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
    }

    #[test]
    fn now_playing_describes_the_present_and_carries_no_timestamp() {
        let (_dir, db) = library();
        connect(&db);
        let transport = FakeTransport::always(r#"{"nowplaying":{}}"#);
        let log = transport.log();

        let (service, _) = service(db, transport);
        service.now_playing(1, 1_700_000_000).unwrap();

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

        let (service, _) = service(db, FakeTransport::scripted(Vec::new()));
        service.played(1, 1_700_000_000).unwrap();
        service.now_playing(1, 1_700_000_000).unwrap();
    }

    #[test]
    fn a_track_the_library_no_longer_has_is_not_an_error() {
        let (_dir, db) = library();
        connect(&db);
        let (service, _) = service(db, FakeTransport::scripted(Vec::new()));

        service.played(999, 1_700_000_000).unwrap();
    }

    #[test]
    fn a_dead_session_key_is_forgotten_and_reported_once() {
        let (_dir, db) = library();
        connect(&db);
        let transport = FakeTransport::always(
            r#"{"error":9,"message":"Invalid session key - Please re-authenticate"}"#,
        );

        let (service, disconnects) = service(db.clone(), transport);
        service.played(1, 1_700_000_000).unwrap_err();

        let conn = db.conn().unwrap();
        assert_eq!(auth::stored_session(&conn).unwrap(), None);
        assert_eq!(disconnects.load(Ordering::SeqCst), 1);
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
            // HTTP 200, `text/plain`, and `format=json` ignored entirely.
            Ok("FAILED Incorrect protocol version. Please update your client.".to_owned()),
        ] {
            let (service, disconnects) = service(db.clone(), FakeTransport::scripted(vec![body]));
            service.played(1, 1_700_000_000).unwrap_err();

            let conn = db.conn().unwrap();
            assert!(auth::stored_session(&conn).unwrap().is_some());
            assert_eq!(disconnects.load(Ordering::SeqCst), 0);
        }
    }

    #[test]
    fn the_session_key_is_the_only_secret_that_leaves_and_it_is_signed_for() {
        let (_dir, db) = library();
        connect(&db);
        let transport = FakeTransport::always(OK_SCROBBLE);
        let log = transport.log();

        let (service, _) = service(db, transport);
        service.played(1, 1_700_000_000).unwrap();

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

        assert_eq!(accepted(&value, 2), Some(vec![true, false]));
    }

    #[test]
    fn one_scrobble_comes_back_as_an_object_rather_than_an_array_of_one() {
        let value: Value = serde_json::from_str(OK_SCROBBLE).unwrap();
        assert_eq!(accepted(&value, 1), Some(vec![true]));
    }

    #[test]
    fn a_response_that_does_not_describe_the_batch_answers_nothing() {
        // Not "all accepted". This is the case where guessing would throw plays
        // away, and it is why the flags are an `Option`.
        let empty: Value = serde_json::from_str("{}").unwrap();
        assert_eq!(accepted(&empty, 1), None);

        let short: Value =
            serde_json::from_str(r#"{"scrobbles":{"scrobble":[{"ignoredMessage":{"code":"0"}}]}}"#)
                .unwrap();
        assert_eq!(accepted(&short, 2), None);
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
