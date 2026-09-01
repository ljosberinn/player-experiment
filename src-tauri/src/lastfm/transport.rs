//! The seam between last.fm and everything that talks to it.
//!
//! [`Transport`] is to this feature what [`crate::audio::sink::AudioSink`] is
//! to playback: the one place that opens a socket, behind a trait, so that
//! every rule above it - what to sign, when a play is worth sending, what a
//! partly-rejected batch means - is tested against a fake on a runner with no
//! network. Nothing above this file knows HTTP exists.
//!
//! **Synchronous on purpose.** The scrobbler owns a thread of its own, the way
//! the player does, rather than borrowing Tauri's async runtime: a blocking
//! call on a thread that exists to make blocking calls needs no runtime, no
//! `async` colouring up through `rules` and `queue`, and no `spawn_blocking`
//! at every call site.

use std::time::Duration;

/// Where the API lives. One root for every method; the method is a parameter.
pub const API_ROOT: &str = "https://ws.audioscrobbler.com/2.0/";

/// What this build calls itself to last.fm. A version, so a bug in one release
/// is distinguishable from the same bug in another.
pub const USER_AGENT: &str = concat!("apex/", env!("CARGO_PKG_VERSION"));

/// How long a call may take before it counts as unreachable.
///
/// A scrobble is not urgent, but the thread making it is also the one that
/// drains the queue, so an unbounded wait would stall every scrobble behind a
/// single hung connection.
const TIMEOUT: Duration = Duration::from_secs(20);

/// A request that produced no answer worth parsing.
///
/// Deliberately narrow: **an HTTP status is not how last.fm reports API
/// errors**. It answers most of them with 200 and an error envelope in the
/// body, and some with a 4xx carrying the same envelope, so both are handed
/// upwards as `Ok` for the parser to read. What reaches here is the case with
/// no envelope to read at all.
#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    /// No answer: no route, DNS failure, TLS failure, timeout, refused.
    #[error("could not reach last.fm: {0}")]
    Unreachable(String),
    /// An answer from something other than the API - a gateway, a captive
    /// portal, a 5xx page. The body is not the API's, so it is not offered.
    #[error("last.fm answered with HTTP {status}")]
    Server { status: u16 },
}

impl TransportError {
    /// Whether trying the same request later could work.
    ///
    /// True for both variants: an unreachable host and a 5xx are the two ways
    /// the network is temporarily not cooperating. Kept as a method rather
    /// than assumed at call sites so that a variant added later has to answer
    /// the question.
    pub fn transient(&self) -> bool {
        match self {
            Self::Unreachable(_) => true,
            Self::Server { .. } => true,
        }
    }
}

/// Somewhere a signed request can be sent.
///
/// Driven from the scrobbler thread, so `Send` is enough; nothing shares one
/// across threads. `&self` rather than `&mut self` because an implementation
/// holds a connection pool, not a position.
pub trait Transport: Send {
    /// One form-encoded POST to the API root, resolving to the body.
    ///
    /// POST for every method, including the read-only ones: `track.scrobble`
    /// accepts nothing else, and one shape is one thing to sign.
    fn post(&self, params: &[(&str, String)]) -> Result<String, TransportError>;
}

/// The one implementation that uses the network.
pub struct HttpTransport {
    client: reqwest::blocking::Client,
    root: String,
}

impl HttpTransport {
    /// A transport pointed at the real API.
    pub fn new(user_agent: &str) -> Result<Self, TransportError> {
        Self::pointed_at(API_ROOT, user_agent)
    }

    /// A transport pointed somewhere else, which in practice means a loopback
    /// server in the one test that exercises this file.
    pub fn pointed_at(root: &str, user_agent: &str) -> Result<Self, TransportError> {
        let client = reqwest::blocking::Client::builder()
            .timeout(TIMEOUT)
            .user_agent(user_agent)
            .build()
            .map_err(|e| TransportError::Unreachable(e.to_string()))?;
        Ok(Self {
            client,
            root: root.to_owned(),
        })
    }
}

impl Transport for HttpTransport {
    fn post(&self, params: &[(&str, String)]) -> Result<String, TransportError> {
        let response = self
            .client
            .post(&self.root)
            .form(params)
            .send()
            .map_err(|e| TransportError::Unreachable(e.to_string()))?;

        let status = response.status();
        // 4xx is handed upwards with its body: that is how last.fm returns
        // "invalid session key" and friends, and throwing the body away here
        // would turn a nine into an unclassifiable failure. 5xx is not the
        // API answering, so there is nothing to parse.
        if status.is_server_error() || status.is_redirection() {
            return Err(TransportError::Server {
                status: status.as_u16(),
            });
        }

        response
            .text()
            .map_err(|e| TransportError::Unreachable(e.to_string()))
    }
}

/// The one client the app talks to last.fm through.
///
/// Built once. A `reqwest::blocking::Client` owns a connection pool, and the
/// browser trip polls every couple of seconds - one client per poll would open
/// a fresh TLS session each time and throw it away.
///
/// `None` only if the client cannot be built at all, which the caller reports
/// as the feature being unavailable rather than as a failed scrobble.
pub fn shared() -> Option<&'static HttpTransport> {
    static SHARED: std::sync::OnceLock<Option<HttpTransport>> = std::sync::OnceLock::new();
    SHARED
        .get_or_init(|| HttpTransport::new(USER_AGENT).ok())
        .as_ref()
}

/// One recorded request: its parameters, owned.
#[cfg(test)]
pub type Call = Vec<(String, String)>;

/// Every request a [`FakeTransport`] was given.
///
/// Its own handle, cloneable and shared, because the interesting subjects above
/// this file (the service, the scrobbler) take ownership of their transport. A
/// test takes one of these before handing the transport over, and reads it
/// afterwards.
#[cfg(test)]
#[derive(Clone, Default)]
pub struct CallLog(std::sync::Arc<std::sync::Mutex<Vec<Call>>>);

#[cfg(test)]
impl CallLog {
    pub fn calls(&self) -> Vec<Call> {
        self.0.lock().expect("the fake transport's log").clone()
    }

    pub fn count(&self) -> usize {
        self.0.lock().expect("the fake transport's log").len()
    }

    /// One parameter of the nth call, for assertions that care about a value
    /// rather than the whole request.
    pub fn param(&self, call: usize, name: &str) -> Option<String> {
        self.calls()
            .get(call)?
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    }

    /// The parameter names of the nth call, in the order they were sent.
    pub fn names(&self, call: usize) -> Vec<String> {
        self.calls()
            .get(call)
            .map(|params| params.iter().map(|(name, _)| name.clone()).collect())
            .unwrap_or_default()
    }
}

/// A [`Transport`] that answers from a script and remembers what it was asked.
///
/// The whole testing strategy above this file: canned bodies for success, for
/// each error worth branching on, and for the legacy `text/plain` reply that
/// arrives with HTTP 200 - none of which a real server would produce on
/// demand.
#[cfg(test)]
pub struct FakeTransport {
    /// Answers, oldest first. Emptied as they are used unless `repeat` is set.
    answers: std::sync::Mutex<std::collections::VecDeque<Result<String, TransportError>>>,
    /// Whether the last answer stands in for every call after it.
    repeat: bool,
    calls: CallLog,
}

#[cfg(test)]
impl FakeTransport {
    /// Answers each call from `answers` in turn, and panics once they run out.
    ///
    /// Running out is a test that made a call it did not plan for, which is a
    /// fact worth failing on rather than papering over with a default - and
    /// `scripted(Vec::new())` is how "this must never be called" is asserted.
    pub fn scripted(answers: Vec<Result<String, TransportError>>) -> Self {
        Self {
            answers: std::sync::Mutex::new(answers.into()),
            repeat: false,
            calls: CallLog::default(),
        }
    }

    /// Answers every call with the same body.
    pub fn always(body: &str) -> Self {
        Self {
            answers: std::sync::Mutex::new([Ok(body.to_owned())].into()),
            repeat: true,
            calls: CallLog::default(),
        }
    }

    /// Fails every call the same way.
    pub fn always_failing(error: TransportError) -> Self {
        Self {
            answers: std::sync::Mutex::new([Err(error)].into()),
            repeat: true,
            calls: CallLog::default(),
        }
    }

    /// The log, which outlives the transport being moved into a subject.
    pub fn log(&self) -> CallLog {
        self.calls.clone()
    }

    pub fn calls(&self) -> Vec<Call> {
        self.calls.calls()
    }

    pub fn call_count(&self) -> usize {
        self.calls.count()
    }

    pub fn param(&self, call: usize, name: &str) -> Option<String> {
        self.calls.param(call, name)
    }
}

#[cfg(test)]
impl Transport for FakeTransport {
    fn post(&self, params: &[(&str, String)]) -> Result<String, TransportError> {
        self.calls.0.lock().expect("the fake transport's log").push(
            params
                .iter()
                .map(|(name, value)| ((*name).to_owned(), value.clone()))
                .collect(),
        );

        let mut answers = self.answers.lock().expect("the fake transport's script");
        if self.repeat && answers.len() == 1 {
            return match answers.front().expect("checked non-empty") {
                Ok(body) => Ok(body.clone()),
                Err(TransportError::Unreachable(message)) => {
                    Err(TransportError::Unreachable(message.clone()))
                }
                Err(TransportError::Server { status }) => {
                    Err(TransportError::Server { status: *status })
                }
            };
        }
        answers
            .pop_front()
            .expect("the fake transport was called more often than it was given answers for")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fake_records_what_it_was_asked_and_answers_in_order() {
        let transport =
            FakeTransport::scripted(vec![Ok("first".to_owned()), Ok("second".to_owned())]);

        assert_eq!(
            transport
                .post(&[("method", "auth.getToken".to_owned())])
                .unwrap(),
            "first"
        );
        assert_eq!(
            transport.post(&[("method", "x".to_owned())]).unwrap(),
            "second"
        );

        assert_eq!(transport.call_count(), 2);
        assert_eq!(
            transport.param(0, "method").as_deref(),
            Some("auth.getToken")
        );
    }

    #[test]
    fn a_repeating_fake_answers_every_call() {
        let transport = FakeTransport::always("{}");
        for _ in 0..3 {
            assert_eq!(transport.post(&[]).unwrap(), "{}");
        }
        assert_eq!(transport.call_count(), 3);
    }

    #[test]
    fn both_ways_of_failing_are_worth_trying_again() {
        assert!(TransportError::Unreachable("refused".into()).transient());
        assert!(TransportError::Server { status: 503 }.transient());
    }

    /// The only test in the tree that opens a socket, and the reason it earns
    /// its keep: every layer above `Transport` is exercised against the fake
    /// above, which would go on passing while the real transport posted to the
    /// wrong URL with the wrong encoding. `wiremock` binds an ephemeral port
    /// on 127.0.0.1 - no egress, no credentials.
    ///
    /// Multi-threaded because the client under test is blocking: it has to run
    /// on a thread other than the one driving the server, or the two wait on
    /// each other.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_real_round_trip_posts_a_form_and_returns_the_body() {
        use wiremock::matchers::{body_string_contains, header, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2.0/"))
            .and(header("content-type", "application/x-www-form-urlencoded"))
            // Percent-encoded in the body, which is the half a hand-rolled
            // encoder gets wrong: a space is `+` and everything else is `%xx`.
            .and(body_string_contains("artist=Blue+Room"))
            .and(body_string_contains("method=track.scrobble"))
            .respond_with(ResponseTemplate::new(200).set_body_string(r#"{"scrobbles":{}}"#))
            .mount(&server)
            .await;

        let root = format!("{}/2.0/", server.uri());
        let body = tokio::task::spawn_blocking(move || {
            HttpTransport::pointed_at(&root, "apex/test")
                .unwrap()
                .post(&[
                    ("method", "track.scrobble".to_owned()),
                    ("artist", "Blue Room".to_owned()),
                ])
        })
        .await
        .unwrap()
        .unwrap();

        assert_eq!(body, r#"{"scrobbles":{}}"#);
    }

    /// A 4xx carries the API's own error envelope, so the body has to survive
    /// the trip; a 5xx is a gateway page and does not.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_client_error_keeps_its_body_and_a_server_error_becomes_an_error() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/client/"))
            .respond_with(ResponseTemplate::new(403).set_body_string(r#"{"error":9}"#))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/server/"))
            .respond_with(ResponseTemplate::new(503).set_body_string("<html>nope</html>"))
            .mount(&server)
            .await;

        let base = server.uri();
        let (client, server_side) = tokio::task::spawn_blocking(move || {
            let client = HttpTransport::pointed_at(&format!("{base}/client/"), "apex/test")
                .unwrap()
                .post(&[]);
            let server_side = HttpTransport::pointed_at(&format!("{base}/server/"), "apex/test")
                .unwrap()
                .post(&[]);
            (client, server_side)
        })
        .await
        .unwrap();

        assert_eq!(client.unwrap(), r#"{"error":9}"#);
        assert!(matches!(
            server_side,
            Err(TransportError::Server { status: 503 })
        ));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn nothing_listening_is_unreachable_rather_than_a_status() {
        // A port nobody is on: the connection-refused path, which is what an
        // offline machine looks like and what the queue has to survive.
        let error = tokio::task::spawn_blocking(|| {
            HttpTransport::pointed_at("http://127.0.0.1:1/2.0/", "apex/test")
                .unwrap()
                .post(&[])
        })
        .await
        .unwrap()
        .expect_err("nothing is listening on port 1");

        assert!(matches!(error, TransportError::Unreachable(_)));
    }
}
